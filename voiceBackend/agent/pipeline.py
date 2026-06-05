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

  VAD   Silero (local, CPU)
  Turn  MultilingualModel + adaptive interruption

IMPORTANT — lk_inference.STT/TTS fallback only accepts:
  - Plain strings:  "deepgram/nova-3", "cartesia/ink-whisper"
  - FallbackModel TypedDicts: {"model": "deepgram/nova-3"}
  Plugin instances (deepgram.STT(), cartesia.TTS()) are NOT valid fallback
  entries and will silently fail at runtime. Use plugin STT/TTS as the
  final fallback OUTSIDE the inference wrapper via a separate FallbackAdapter.
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
            "You are Aria, a warm and intelligent voice AI assistant. "
            "Keep responses concise, natural, and conversational. "
            "Never use bullet points or markdown — speak in plain prose."
        )


# ─────────────────────────────────────────────────────────────────────────────
# Clean log filter — replace giant traceback spam with one-liners
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
# STT — LiveKit inference (3-model) + direct plugin last resort
# ─────────────────────────────────────────────────────────────────────────────

def _build_stt() -> STTFallbackAdapter | lk_inference.STT:
    """
    Chain:
      1. lk/deepgram/nova-3       — best accuracy, datacenter-local
      2. lk/deepgram/flux-general-en  — Deepgram's newer model
      3. lk/cartesia/ink-whisper  — separate provider
      4. deepgram plugin direct   — bypasses LiveKit inference entirely,
                                    uses DEEPGRAM_API_KEY directly as last resort

    NOTE: The fallback= list on lk_inference.STT ONLY accepts plain strings
    ("model/name") or FallbackModel TypedDicts. Passing a plugin instance
    (deepgram.STT()) there will silently corrupt the fallback chain.
    The plugin fallback must go outside via STTFallbackAdapter.
    """
    lk_stt = lk_inference.STT(
        model    = "deepgram/nova-3",
        language = "en",
        fallback = [
            "deepgram/flux-general-en",
            "cartesia/ink-whisper",
        ],
    )

    # Direct plugin as absolute last resort — completely bypasses LK inference
    plugin_stt = deepgram.STT(model="nova-3", language="en")

    return STTFallbackAdapter(stt=[lk_stt, plugin_stt])


# ─────────────────────────────────────────────────────────────────────────────
# LLM — LiveKit inference primary + Groq plugin fallbacks
# ─────────────────────────────────────────────────────────────────────────────

def _build_llm() -> FallbackAdapter:
    """
    Tier 1  lk/gpt-4.1-mini       full history, fast, uses LIVEKIT_API_KEY
    Tier 2  groq/llama-3.3-70b    full history, 128k ctx, free 100k TPD
    Tier 3  groq/llama-3.1-8b     32k ctx, separate TPD bucket from 70b
    """
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
# TTS — LiveKit inference (3-model) + direct plugin last resort
# ─────────────────────────────────────────────────────────────────────────────

def _build_tts() -> TTSFallbackAdapter | lk_inference.TTS:
    """
    Chain:
      1. lk/cartesia/sonic-3      — best quality, 24kHz
      2. lk/cartesia/sonic-turbo  — lower latency
      3. lk/deepgram/aura-2       — separate provider
      4. cartesia plugin direct   — bypasses LiveKit inference, uses CARTESIA_API_KEY

    Same note as STT: the plugin instance must go in TTSFallbackAdapter,
    NOT inside the fallback= list of lk_inference.TTS.
    """
    lk_tts = lk_inference.TTS(
        model    = "cartesia/sonic-3",
        language = "en",
        fallback = [
            "cartesia/sonic-turbo",
            "deepgram/aura-2",
        ],
    )

    # Direct plugin as absolute last resort
    plugin_tts = cartesia.TTS(model="sonic-3", language="en")

    return TTSFallbackAdapter(tts=[lk_tts, plugin_tts])


# ─────────────────────────────────────────────────────────────────────────────
# Agent
# ─────────────────────────────────────────────────────────────────────────────

class VoiceAssistant(Agent):
    """Aria — voice assistant with full tool access."""

    def __init__(self) -> None:
        super().__init__(
            instructions = _load_system_prompt(),
            tools        = [get_weather, get_news, calculate, send_frontend_action],
        )


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline factory
# ─────────────────────────────────────────────────────────────────────────────

def create_session() -> AgentSession:
    """
    Build a fully optimised AgentSession.

    Tuning rationale:
      endpointing dynamic/0.3s    ML turn detector is confident, so min_delay
                                  can be lower than default 0.5s safely.

      preemptive_tts=True         Both LLM and TTS start speculatively before
                                  turn is confirmed — shaves 150-300ms latency.

      interruption adaptive       ML-based, far fewer false positives than VAD.
      false_interruption_timeout  1.5s — resume speaking after background noise.

      aec_warmup_duration 2.0s    Default is 3s. Fine to lower with decent mics.
      max_tool_steps 5            Richer tool chains than default 3.
    """
    session = AgentSession(
        vad = silero.VAD.load(
            min_silence_duration    = 0.4,   # slightly faster than default 0.55
            activation_threshold    = 0.5,
            prefix_padding_duration = 0.3,
        ),
        stt = _build_stt(),
        llm = _build_llm(),
        tts = _build_tts(),

        turn_handling = TurnHandlingOptions(
            turn_detection = MultilingualModel(),

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