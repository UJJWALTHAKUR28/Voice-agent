"""
Voice agent pipeline — wires VAD → STT → LLM → TTS into a LiveKit AgentSession.

This module configures all the pipeline components (Silero VAD, Deepgram STT,
Groq LLM, and Cartesia TTS) and defines the Agent class with registered tools.
It exposes `create_session()` for the main entry point to call.

Pipeline:
    VAD  — Silero VAD (local, runs on CPU, no API key needed)
    STT  — Deepgram Nova-3 via `livekit-plugins-deepgram` (streaming)
    LLM  — Groq Llama-3.3-70B via `livekit-plugins-groq` (sub-200ms TTFB)
    TTS  — Cartesia Sonic-2 via `livekit-plugins-cartesia` (streaming, sub-100ms TTFB)
    Turn — LiveKit Multilingual turn detector (ML-based, not silence timer)

Transport:
    All audio flows over WebRTC via LiveKit Cloud rooms.
    Browser ←→ LiveKit Cloud ←→ Python Agent (this process)
"""

from __future__ import annotations

import logging
from pathlib import Path

from livekit.agents import Agent, AgentSession, TurnHandlingOptions
from livekit.plugins import cartesia, deepgram, groq, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from agent.tools import get_weather, search_wikipedia, send_frontend_action
from agent.tools.server_tools import get_news, calculate
from config.settings import get_settings

logger = logging.getLogger("voice-agent.pipeline")

# ──────────────────────────────────────────────────────────────────────
# Load the system prompt from disk
# ──────────────────────────────────────────────────────────────────────

_PROMPT_PATH = Path(__file__).parent / "prompts" / "system_prompt.txt"


def _load_system_prompt() -> str:
    """Read the system prompt file, with a sensible fallback."""
    try:
        return _PROMPT_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        logger.warning("System prompt not found at %s — using default.", _PROMPT_PATH)
        return (
            "You are a helpful voice AI assistant. "
            "Keep your responses concise and conversational."
        )


# ──────────────────────────────────────────────────────────────────────
# Assistant Agent — carries personality + tools
# ──────────────────────────────────────────────────────────────────────

class VoiceAssistant(Agent):
    """
    The primary voice agent.

    - System instructions are loaded from `prompts/system_prompt.txt`.
    - Server-side tools (weather, Wikipedia, news, calculate) are registered.
    - The client-tool handler lets the LLM push actions to the browser.
    """

    def __init__(self) -> None:
        super().__init__(
            instructions=_load_system_prompt(),
            tools=[
                get_weather,
                search_wikipedia,
                get_news,
                calculate,
                send_frontend_action,
            ],
        )


# ──────────────────────────────────────────────────────────────────────
# Pipeline factory
# ──────────────────────────────────────────────────────────────────────

def create_session() -> AgentSession:
    """
    Build and return a fully-configured AgentSession.

    Components:
        VAD  — Silero VAD (local, runs on CPU)
        STT  — Deepgram Nova-3 via `livekit-plugins-deepgram`
        LLM  — Groq (Llama-3.3-70B) via `livekit-plugins-groq`
        TTS  — Cartesia Sonic-2 via `livekit-plugins-cartesia`
        Turn — MultilingualModel (ML-based turn detection, not silence timer)

    All audio transport is WebRTC via LiveKit Cloud.
    The Cartesia plugin handles WebSocket streaming natively.
    """
    settings = get_settings()

    # ── VAD — Silero (local, no API key) ──
    vad = silero.VAD.load()

    # ── STT — Deepgram Nova-3 (streaming transcription) ──
    stt = deepgram.STT(
        model=settings.deepgram_model,
        language=settings.deepgram_language,
    )

    # ── LLM — Groq Llama-3.3-70B (sub-200ms first token) ──
    llm = groq.LLM(
        model=settings.groq_model,
    )

    # ── TTS — Cartesia Sonic-2 (streaming, sub-100ms TTFB) ──
    tts_engine = cartesia.TTS(
        model=settings.cartesia_model,
        voice=settings.cartesia_voice_id,
        language=settings.cartesia_language,
    )

    # ── Turn Detection — ML-based multilingual model ──
    # Uses LiveKit's trained turn detector instead of a simple silence timer.
    # This understands natural pauses vs actual end-of-turn, so the agent
    # doesn't interrupt the user mid-sentence.
    turn_detection = MultilingualModel()

    session = AgentSession(
        vad=vad,
        stt=stt,
        llm=llm,
        tts=tts_engine,
        turn_handling=TurnHandlingOptions(
            turn_detection=turn_detection,
        ),
    )

    logger.info(
        f"Pipeline created: VAD=silero | STT=deepgram/{settings.deepgram_model} | "
        f"LLM=groq/{settings.groq_model} | TTS=cartesia/{settings.cartesia_model} | "
        "Turn=multilingual-model"
    )

    return session
