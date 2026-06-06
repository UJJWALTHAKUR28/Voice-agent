"""
Voice Agent Pipeline — Maximum performance, provider-aware context management.

Architecture:
─────────────────────────────────────────────────────────────────────────────
  STT   LiveKit inference  deepgram/nova-3           (primary)
                           deepgram/flux-general-en  (fallback)
                           cartesia/ink-whisper      (fallback)
                           deepgram plugin           (last resort — direct key)

  LLM   LiveKit inference  openai/gpt-4.1-mini       (primary  — fast, full ctx)
        Groq               llama-3.3-70b-versatile   (fallback — 128k ctx)
        Groq               llama-3.1-8b-instant      (fallback — separate TPD)

  TTS   LiveKit inference  cartesia/sonic-3           (primary)
                           cartesia/sonic-turbo       (fallback)
                           deepgram/aura-2            (fallback)
                           cartesia plugin            (last resort — direct key)

  VAD   Silero (local, CPU) — pre-warmed at worker startup
  Turn  MultilingualModel  — pre-warmed at worker startup
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from livekit.agents import (
    Agent,
    AgentSession,
    EndpointingOptions,
    InterruptionOptions,
    PreemptiveGenerationOptions,
    TurnHandlingOptions,
)
from livekit.agents import inference as lk_inference
from livekit.agents.llm import FallbackAdapter, LLM
from livekit.agents.stt import FallbackAdapter as STTFallbackAdapter
from livekit.agents.tts import FallbackAdapter as TTSFallbackAdapter
from livekit.plugins import cartesia, deepgram, groq, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from agent.tools import calculate, get_news, get_weather, send_frontend_action

logger = logging.getLogger("voice-agent.pipeline")


# ─────────────────────────────────────────────────────────────────────────────
# System prompt
# ─────────────────────────────────────────────────────────────────────────────

_PROMPT_PATH = Path(__file__).parent / "prompts" / "system_prompt.txt"


def _load_system_prompt() -> str:
    try:
        return _PROMPT_PATH.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        logger.warning("system_prompt.txt not found — using built-in default.")
        return (
            "You are Jocasta, a warm and intelligent voice AI assistant. "
            "Keep responses concise, natural, and conversational. "
            "Never use bullet points or markdown — speak in plain prose."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Clean log filter
# ─────────────────────────────────────────────────────────────────────────────

class _CleanLogFilter(logging.Filter):
    _NOISE = (
        "failed, switching to next LLM",
        "recovery failed",
        "flush audio emitter due to slow audio",
        "aec warmup",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        for pattern in self._NOISE:
            if pattern in msg:
                record.exc_info   = None
                record.exc_text   = None
                record.stack_info = None
                record.msg = (
                    "⚡ LLM rate-limited/failed → next provider"
                    if ("429" in msg or "rate_limit" in msg or "recovery failed" in msg)
                    else f"[livekit] {pattern}"
                )
                record.args = ()
                return True
        return True


logging.getLogger("livekit.agents").addFilter(_CleanLogFilter())
logging.getLogger("livekit.agents.llm.fallback_adapter").setLevel(logging.ERROR)
logging.getLogger("livekit.plugins").setLevel(logging.WARNING)


# ─────────────────────────────────────────────────────────────────────────────
# STT
# ─────────────────────────────────────────────────────────────────────────────

def _build_stt() -> STTFallbackAdapter:
    lk_stt = lk_inference.STT(
        model    = "deepgram/nova-3",
        language = "en",
        fallback = [
            "deepgram/flux-general-en",
            "cartesia/ink-whisper",
        ],
    )
    plugin_stt = deepgram.STT(model="nova-3", language="en")
    return STTFallbackAdapter(stt=[lk_stt, plugin_stt])


# ─────────────────────────────────────────────────────────────────────────────
# LLM
# ─────────────────────────────────────────────────────────────────────────────

def _build_llm() -> FallbackAdapter:
    from config.settings import get_settings
    s = get_settings()

    lk_llm   = lk_inference.LLM(model="openai/gpt-4.1-mini")
    groq_70b = groq.LLM(model=s.groq_model,           tool_choice="auto")
    groq_8b  = groq.LLM(model="llama-3.1-8b-instant", tool_choice="auto")

    logger.info(
        "LLM chain: lk/gpt-4.1-mini → groq/%s → groq/llama-3.1-8b",
        s.groq_model,
    )
    return FallbackAdapter(llm=[lk_llm, groq_70b, groq_8b], attempt_timeout=6.0)


# ─────────────────────────────────────────────────────────────────────────────
# TTS
# ─────────────────────────────────────────────────────────────────────────────

def _build_tts() -> TTSFallbackAdapter:
    _VOICE_ID = "ec1e269e-9ca0-402f-8a18-58e0e022355a"

    lk_tts = lk_inference.TTS(
        model    = "cartesia/sonic-3",
        voice    = _VOICE_ID,
        language = "en",
        fallback = [
            {"model": "cartesia/sonic-turbo", "voice": _VOICE_ID},
            "deepgram/aura-2",
        ],
    )
    plugin_tts = cartesia.TTS(model="sonic-3", voice=_VOICE_ID, language="en")
    return TTSFallbackAdapter(tts=[lk_tts, plugin_tts])


# ─────────────────────────────────────────────────────────────────────────────
# Agent
# ─────────────────────────────────────────────────────────────────────────────

class VoiceAssistant(Agent):
    """Jocasta — voice assistant with full tool access."""

    def __init__(self) -> None:
        super().__init__(
            instructions = _load_system_prompt(),
            tools        = [get_weather, get_news, calculate, send_frontend_action],
        )


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline factory — accepts pre-warmed models from main.py _prewarm()
# ─────────────────────────────────────────────────────────────────────────────

def create_session(
    prewarmed_vad:        Any | None = None,
    prewarmed_turn_model: Any | None = None,
) -> AgentSession:
    """
    Build a fully optimised AgentSession.

    If pre-warmed models are passed in (from _prewarm() in main.py), they are
    reused directly. Otherwise they are loaded fresh (slower — first-time only).

    Pre-warming moves the ~3-minute model load from "first caller waits" to
    "happens once at worker startup before anyone joins".
    """

    # ── VAD ──────────────────────────────────────────────────────────────────
    if prewarmed_vad is not None:
        vad = prewarmed_vad
        logger.info("using pre-warmed VAD")
    else:
        logger.info("loading VAD fresh (not pre-warmed)")
        vad = silero.VAD.load(
            min_silence_duration    = 0.4,
            activation_threshold    = 0.5,
            prefix_padding_duration = 0.3,
        )

    # ── Turn detector ─────────────────────────────────────────────────────────
    if prewarmed_turn_model is not None:
        turn_model = prewarmed_turn_model
        logger.info("using pre-warmed MultilingualModel")
    else:
        logger.info("loading MultilingualModel fresh (not pre-warmed — expect delay)")
        turn_model = MultilingualModel()

    # ── Session ───────────────────────────────────────────────────────────────
    session = AgentSession(
        vad = vad,
        stt = _build_stt(),
        llm = _build_llm(),
        tts = _build_tts(),

        turn_handling = TurnHandlingOptions(
            turn_detection = turn_model,

            endpointing = EndpointingOptions(
                mode      = "dynamic",
                min_delay = 0.3,
                max_delay = 2.5,
            ),

            interruption = InterruptionOptions(
                enabled                    = True,
                mode                       = "adaptive",
                min_duration               = 0.4,
                min_words                  = 2,
                resume_false_interruption  = True,
                false_interruption_timeout = 1.5,
            ),

            preemptive_generation = PreemptiveGenerationOptions(
                enabled             = True,
                preemptive_tts      = True,
                max_speech_duration = 8.0,
                max_retries         = 3,
            ),
        ),

        aec_warmup_duration = 2.0,
        max_tool_steps      = 5,
    )

    logger.info(
        "Pipeline ready | "
        "STT=lk(nova-3→flux→ink-whisper)→deepgram | "
        "LLM=lk/gpt-4.1-mini→groq(70b→8b) | "
        "TTS=lk(sonic-3→sonic-turbo→aura-2)→cartesia"
    )
    return session