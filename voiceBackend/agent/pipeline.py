"""
Voice agent pipeline — wires VAD → STT → LLM → TTS into a LiveKit AgentSession.

LLM strategy — Groq first, Cerebras fallback:
  Primary:  Groq  llama-3.3-70b-versatile  (sub-200ms TTFB, free tier)
  Fallback: Cerebras gpt-oss-120b          (kicks in on 429 rate-limit errors)

Pipeline:
    VAD  — Silero VAD (local, runs on CPU, no API key needed)
    STT  — Deepgram Nova-3 via `livekit-plugins-deepgram` (streaming)
    LLM  — Groq Llama-3.3-70B → Cerebras GPT-OSS-120B (fallback)
    TTS  — Cartesia Sonic-2 via `livekit-plugins-cartesia` (streaming)
    Turn — LiveKit Multilingual turn detector (ML-based, not silence timer)

Cerebras setup:
    1. Sign up at https://cloud.cerebras.ai
    2. Get an API key and set CEREBRAS_API_KEY in .env
    3. Cerebras runs via OpenAI SDK with base_url

Transport:
    All audio flows over WebRTC via LiveKit Cloud rooms.
    Browser ←→ LiveKit Cloud ←→ Python Agent (this process)
"""

from __future__ import annotations

import logging
from pathlib import Path

from livekit.agents import Agent, AgentSession, TurnHandlingOptions
from livekit.agents.llm import FallbackAdapter
from livekit.agents.tts import FallbackAdapter as TTSFallbackAdapter
from livekit.plugins import cartesia, deepgram, groq, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

# pipeline.py — FIXED import
from agent.tools import get_weather, get_news, calculate, send_frontend_action

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
# Fallback-aware LLM wrapper
# ──────────────────────────────────────────────────────────────────────

def _build_llm():
    """
    Return a FallbackAdapter: Groq first, Cerebras if Groq hits 429.

    FallbackAdapter is built into livekit-agents — no extra code needed.
    It catches retryable errors (including 429 rate-limit) and switches
    to the next provider transparently mid-conversation.

    Cerebras fallback requires:
        1. CEREBRAS_API_KEY in .env (get it free from cloud.cerebras.ai)
        2. livekit-plugins-openai (which we use to talk to Cerebras)
    """
    from config.settings import get_settings
    settings = get_settings()

    primary = groq.LLM(
        model=settings.groq_model,
        tool_choice="auto",   
    )

    # Secondary: Groq's 8B model (has separate rate limits from 70B)
    secondary = groq.LLM(
        model="llama-3.1-8b-instant",
        tool_choice="auto",
    )

    # Tertiary: Cerebras exposes an OpenAI-compatible API
    tertiary = openai.LLM(
        model=settings.cerebras_model,
        base_url="https://api.cerebras.ai/v1",
        api_key=settings.cerebras_api_key,
        tool_choice="auto",
    )

    llm = FallbackAdapter(
        llm=[primary, secondary, tertiary],
        # On the FIRST failure of an LLM, switch to the next one immediately
        attempt_timeout=6.0,
    )

    logger.info(
        "LLM: Groq %s → Groq llama-3.1-8b-instant → Cerebras %s (fallback)",
        settings.groq_model,
        settings.cerebras_model,
    )
    return llm


# ──────────────────────────────────────────────────────────────────────
# Assistant Agent — carries personality + tools
# ──────────────────────────────────────────────────────────────────────

class VoiceAssistant(Agent):
    """
    The primary voice agent.

    - System instructions are loaded from `prompts/system_prompt.txt`.
    - Server-side tools (weather, news, calculate) are registered.
    - The client-tool handler lets the LLM push actions to the browser.
    """

    def __init__(self) -> None:
        super().__init__(
            instructions=_load_system_prompt(),
            tools=[
                get_weather,
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
        LLM  — Groq (Llama-3.3-70B) with Cerebras fallback
        TTS  — Deepgram Aura via `livekit-plugins-deepgram`
        Turn — MultilingualModel (ML-based turn detection)

    All audio transport is WebRTC via LiveKit Cloud.
    """
    # ── VAD — Silero (local, no API key) ──
    vad = silero.VAD.load()

    # ── STT — Deepgram Nova-3 (streaming transcription) ──
    stt = deepgram.STT(
        model="nova-3",
        language="en",
    )

    # ── LLM — Groq primary + Cerebras fallback ──
    llm = _build_llm()

    # ── TTS — Cartesia primary + Deepgram fallback ──
    primary_tts = cartesia.TTS()
    fallback_tts = deepgram.TTS(
        model="aura-asteria-en",  # Asteria is a natural, warm female voice
    )
    tts_engine = TTSFallbackAdapter(
        tts=[primary_tts, fallback_tts]
    )

    # ── Turn Detection — ML-based multilingual model ──
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
        "Pipeline created: VAD=silero | STT=deepgram/nova-3 | "
        "LLM=groq/llama-3.3-70b + cerebras (fallback) | "
        "TTS=cartesia + deepgram/aura (fallback) | Turn=multilingual-model"
    )

    return session