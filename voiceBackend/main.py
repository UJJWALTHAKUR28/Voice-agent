"""
Voice Agent — main entry point.

Starts a LiveKit Agent worker that:
  1. Connects to a LiveKit room when dispatched
  2. Spins up the VAD → STT → LLM → TTS pipeline
  3. Begins listening for user speech

Usage:
    # Development (connects to LiveKit Cloud, auto-creates rooms)
    python main.py dev

    # Production
    python main.py start

    # Local console mode (no browser needed)
    python main.py console
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import AgentServer, AutoSubscribe

# ── Ensure the project root is on sys.path so `agent.*` imports work ──
_PROJECT_ROOT = Path(__file__).parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# ── Load environment variables BEFORE importing plugins ──
# Ensures GROQ_API_KEY, OLLAMA_BASE_URL, etc. are available
# when plugins initialize.
load_dotenv(_PROJECT_ROOT / ".env")

from agent.pipeline import VoiceAssistant, create_session  # noqa: E402

# ── Logging ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-28s  %(levelname)-7s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("voice-agent")


# ──────────────────────────────────────────────────────────────────────
# Agent Server + RTC session handler
# ──────────────────────────────────────────────────────────────────────

server = AgentServer()


@server.rtc_session(agent_name="voice-agent")
async def voice_agent_session(ctx: agents.JobContext):
    """
    Called once per LiveKit room/job.

    1. Connect to the room (audio-only subscription).
    2. Build the pipeline via `create_session()`.
    3. Start the session with our VoiceAssistant agent.
    4. Generate an initial greeting.
    """
    logger.info("New session — room=%s", ctx.room.name)

    # Connect to the room
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Build the pipeline
    session = create_session()

    # Start the agent in the room
    await session.start(
        room=ctx.room,
        agent=VoiceAssistant(),
    )

    # Generate the initial greeting after the agent is live
    await session.generate_reply(
        instructions="Greet the user warmly and let them know what you can help with."
    )

    logger.info("Agent is live in room=%s", ctx.room.name)


# ──────────────────────────────────────────────────────────────────────
# CLI entry point  (python main.py dev | start | console)
# ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    agents.cli.run_app(server)
