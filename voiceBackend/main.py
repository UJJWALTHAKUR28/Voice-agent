"""
Voice Agent — entry point.

    python main.py dev      # development, auto-creates rooms
    python main.py start    # production
    python main.py console  # local console mode, no browser needed

PERFORMANCE FIX:
  The MultilingualModel (turn detector) and silero VAD both load heavy ML
  models from disk on first use. Previously this happened inside the first
  session, causing a 2-4 minute delay for the first caller.

  Fix: pre_warm() at worker startup so models are hot in memory before
  any room joins. Subsequent sessions start in <1s.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# Load .env BEFORE importing plugins so all API keys are available
from dotenv import load_dotenv
load_dotenv(_PROJECT_ROOT / ".env")

from livekit import agents, rtc
from livekit.agents import AgentServer, AutoSubscribe, RunContext
from livekit.agents import stt as agent_stt

# Import after dotenv so plugins pick up env vars at import time
from agent.pipeline import VoiceAssistant, create_session
from agent.apiHealth import check_all_keys

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level    = logging.INFO,
    format   = "%(asctime)s  [%(levelname)-7s]  %(name)s — %(message)s",
    datefmt  = "%H:%M:%S",
    handlers = [logging.StreamHandler(sys.stdout)],
    force    = True,
)
for _lib in ("httpx", "httpcore", "asyncio", "websockets", "aiohttp"):
    logging.getLogger(_lib).setLevel(logging.WARNING)
logging.getLogger("livekit.plugins").setLevel(logging.WARNING)
logging.getLogger("livekit.agents.llm").setLevel(logging.WARNING)

logger = logging.getLogger("voice-agent")


# ─────────────────────────────────────────────────────────────────────────────
# Event publisher — pushes typed events to the browser over DataPackets
# ─────────────────────────────────────────────────────────────────────────────

async def _publish_event(room: rtc.Room, event: dict) -> None:
    """
    Publish a JSON event to all browser participants on topic="agent-event".
    Fire-and-forget — errors are logged but never raised.
    """
    try:
        payload = json.dumps(event).encode("utf-8")
        await room.local_participant.publish_data(
            payload = payload,
            topic   = "agent-event",
            reliable = True,
        )
    except Exception as exc:
        logger.warning("event publish failed: %s", exc)


# ─────────────────────────────────────────────────────────────────────────────
# Pre-warm — load heavy models at worker startup, NOT at first session
# ─────────────────────────────────────────────────────────────────────────────

async def _prewarm(proc: agents.JobProcess) -> None:
    """
    Called once when the worker process starts (before any room joins).
    
    Loads the MultilingualModel turn detector and Silero VAD into memory
    so they are ready instantly when the first session starts.
    
    Previously these loaded lazily inside create_session() → first caller
    waited 2-4 minutes. Now all heavy I/O happens here at startup.
    """
    import time
    t0 = time.monotonic()
    logger.info("pre-warming inference models...")

    try:
        # Pre-warm the turn detector (the slow one — ~3min cold load)
        from livekit.plugins.turn_detector.multilingual import MultilingualModel
        model = MultilingualModel()
        # Storing on proc.userdata makes it reusable across sessions
        proc.userdata["turn_model"] = model
        logger.info("  ✓ MultilingualModel loaded (%.1fs)", time.monotonic() - t0)
    except Exception as exc:
        logger.warning("  ✗ MultilingualModel pre-warm failed: %s", exc)

    try:
        # Pre-warm Silero VAD (loads ONNX model)
        from livekit.plugins import silero
        vad = silero.VAD.load(
            min_silence_duration    = 0.4,
            activation_threshold    = 0.5,
            prefix_padding_duration = 0.3,
        )
        proc.userdata["vad"] = vad
        logger.info("  ✓ Silero VAD loaded (%.1fs)", time.monotonic() - t0)
    except Exception as exc:
        logger.warning("  ✗ Silero VAD pre-warm failed: %s", exc)

    logger.info("pre-warm complete — total %.1fs", time.monotonic() - t0)


# ─────────────────────────────────────────────────────────────────────────────
# Agent session
# ─────────────────────────────────────────────────────────────────────────────

server = AgentServer(
    setup_fnc=_prewarm,  # ← runs once at worker startup, not per-session
)


@server.rtc_session(agent_name="voice-agent")
async def voice_agent_session(ctx: agents.JobContext) -> None:
    """Called once per LiveKit room. Builds the pipeline and starts the agent."""
    logger.info("session start — room=%s", ctx.room.name)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    room    = ctx.room

    # Re-use pre-warmed models from proc.userdata if available
    # This means create_session() gets them instantly instead of reloading
    pre_warmed_vad        = getattr(ctx.proc, "userdata", {}).get("vad")
    pre_warmed_turn_model = getattr(ctx.proc, "userdata", {}).get("turn_model")

    session = create_session(
        prewarmed_vad        = pre_warmed_vad,
        prewarmed_turn_model = pre_warmed_turn_model,
    )

    # ── Wire up transcript + state events → frontend ──────────────────────

    @session.on("user_input_transcribed")
    def on_user_transcript(ev) -> None:
        asyncio.ensure_future(
            _publish_event(room, {
                "event":      "user_input_transcribed",
                "transcript": ev.transcript,
                "is_final":   ev.is_final,
            })
        )

    @session.on("agent_state_changed")
    def on_state_change(ev) -> None:
        asyncio.ensure_future(
            _publish_event(room, {
                "event":     "agent_state_changed",
                "old_state": str(ev.old_state),
                "new_state": str(ev.new_state),
            })
        )

    @session.on("conversation_item_added")
    def on_item_added(ev) -> None:
        item    = ev.item
        role    = getattr(item, "role", None)
        content = getattr(item, "text_content", None) or getattr(item, "content", None)

        if not content or not str(content).strip():
            return

        role_str = role.value if hasattr(role, "value") else str(role)

        asyncio.ensure_future(
            _publish_event(room, {
                "event":   "conversation_item_added",
                "role":    role_str,
                "content": str(content).strip(),
            })
        )

    # ── Text-input listener — typed messages from the browser ──────────────

    @room.on("data_received")
    def on_data(data_packet: rtc.DataPacket) -> None:
        if data_packet.topic != "text-input":
            return

        try:
            payload = json.loads(data_packet.data.decode("utf-8"))
            text    = payload.get("text", "").strip()
        except Exception as exc:
            logger.warning("text-input decode failed: %s", exc)
            return

        if not text:
            return

        logger.info("text-input received: %r", text)

        asyncio.ensure_future(
            _publish_event(room, {
                "event":   "conversation_item_added",
                "role":    "user",
                "content": text,
            })
        )

        asyncio.ensure_future(
            session.generate_reply(user_input=text)
        )

    # ── Start the session ──────────────────────────────────────────────────

    await session.start(room=room, agent=VoiceAssistant())

    await session.generate_reply(
        instructions=(
            "Introduce yourself by name as Jocasta. Say something like: "
            "'Hi! I'm Jocasta, your voice AI assistant.' Then in one sentence "
            "mention you can help with weather, news, calculations, and "
            "general questions. Keep it warm and natural."
        )
    )

    logger.info("agent live — room=%s", ctx.room.name)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    all_ok, _ = asyncio.run(check_all_keys())

    if not all_ok:
        print("  Aborting. Fix the keys above and restart.\n")
        sys.exit(1)

    agents.cli.run_app(server)