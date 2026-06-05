"""
Voice Agent — entry point.

    python main.py dev      # development, auto-creates rooms
    python main.py start    # production
    python main.py console  # local console mode, no browser needed
"""

from __future__ import annotations

import asyncio
import logging
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# Load .env BEFORE importing plugins so all API keys are available
from dotenv import load_dotenv
load_dotenv(_PROJECT_ROOT / ".env")

from livekit import agents
from livekit.agents import AgentServer, AutoSubscribe

# Import after dotenv so plugins pick up env vars at import time
from agent.pipeline import VoiceAssistant, create_session
from agent.apiHealth import check_all_keys   # FIX: was agent.apiHealth (wrong name)

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level    = logging.INFO,
    format   = "%(asctime)s  [%(levelname)-7s]  %(name)s — %(message)s",
    datefmt  = "%H:%M:%S",
    handlers = [logging.StreamHandler(sys.stdout)],
    force    = True,
)
# Silence noisy third-party loggers
for _lib in ("httpx", "httpcore", "asyncio", "websockets", "aiohttp"):
    logging.getLogger(_lib).setLevel(logging.WARNING)
logging.getLogger("livekit.plugins").setLevel(logging.WARNING)
logging.getLogger("livekit.agents.llm").setLevel(logging.WARNING)

logger = logging.getLogger("voice-agent")


# ─────────────────────────────────────────────────────────────────────────────
# Agent server
# ─────────────────────────────────────────────────────────────────────────────

server = AgentServer()


@server.rtc_session(agent_name="voice-agent")
async def voice_agent_session(ctx: agents.JobContext) -> None:
    """Called once per LiveKit room. Builds the pipeline and starts the agent."""
    logger.info("session start — room=%s", ctx.room.name)

    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    session = create_session()
    await session.start(room=ctx.room, agent=VoiceAssistant())
    await session.generate_reply(
        instructions=(
            "Introduce yourself by name. Say something like: "
        "'Hi! I'm Aria, your voice AI assistant.' Then in one sentence "
        "mention you can help with weather, news, calculations, and "
        "general questions. Keep it warm and natural."
        )
    )

    logger.info("agent live — room=%s", ctx.room.name)


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # asyncio.run() here is safe — agents.cli.run_app() creates its own
    # event loop separately, so there is no conflict.
    all_ok, _ = asyncio.run(check_all_keys())

    if not all_ok:
        # Required key is missing/invalid — abort before wasting time connecting
        print("  Aborting. Fix the keys above and restart.\n")
        sys.exit(1)

    agents.cli.run_app(server)