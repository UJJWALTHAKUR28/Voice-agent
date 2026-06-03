"""
config/settings.py
──────────────────
Single source of truth for all environment-variable configuration.

Uses pydantic-settings so every variable is type-validated at startup.
Missing required variables raise a clear error with the variable name —
no silent None's propagating through the system.

Usage:
    from config.settings import get_settings
    settings = get_settings()
    key = settings.cartesia_api_key
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    All configuration for the Voice AI Agent.

    Required variables must be set in .env or the environment.
    Optional variables have sensible defaults.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",          # Ignore unknown env vars — avoids noise
    )

    # ── LiveKit ───────────────────────────────────────────────────────────────
    livekit_url: str = Field(..., description="wss://your-project.livekit.cloud")
    livekit_api_key: str = Field(..., description="LiveKit API key")
    livekit_api_secret: str = Field(..., description="LiveKit API secret")

    # ── LLM — Groq (LLaMA 3.3 70B) ───────────────────────────────────────────
    groq_api_key: str = Field(..., description="Groq API key")
    groq_model: str = Field(
        default="llama-3.3-70b-versatile",
        description="Groq model ID. Use llama-3.3-70b-versatile for best quality.",
    )

    # ── STT — Deepgram ────────────────────────────────────────────────────────
    deepgram_api_key: str = Field(..., description="Deepgram API key")
    deepgram_model: str = Field(
        default="nova-3",
        description="Deepgram STT model. nova-3 = highest accuracy.",
    )
    deepgram_language: str = Field(default="en-US")

    # ── TTS — Cartesia ────────────────────────────────────────────────────────
    cartesia_api_key: str = Field(..., description="Cartesia API key")
    cartesia_model: str = Field(
        default="sonic-2",
        description="Cartesia model ID. sonic-2 = lowest latency.",
    )
    cartesia_voice_id: str = Field(
        default="694f9389-aac1-45b6-b726-9d9369183238",
        description=(
            "Cartesia voice ID. Default: 'Helpful Woman' (warm, natural). "
            "Browse voices at https://play.cartesia.ai/voices"
        ),
    )
    cartesia_language: str = Field(default="en")
    cartesia_sample_rate: int = Field(default=24000)

    # ── Server-Side Tool APIs ─────────────────────────────────────────────────
    openweather_api_key: str = Field(
        ...,
        description="OpenWeatherMap API key (free tier is sufficient)",
    )
    news_api_key: str = Field(
        ...,
        description="NewsAPI.org API key (free tier: 100 requests/day)",
    )

    # ── Agent Behaviour ───────────────────────────────────────────────────────
    agent_name: str = Field(default="Aria", description="Agent display name")

    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO",
        description="Root log level for the agent process",
    )

    # ── Turn Detection ────────────────────────────────────────────────────────
    # Silence duration (seconds) before LiveKit's built-in turn detector fires.
    # The ML-based turn detector overrides this for natural pauses, but this
    # is the hard cap to prevent infinite silence.
    turn_end_silence_s: float = Field(
        default=0.5,
        description="Seconds of silence before turn ends. ML model takes priority.",
    )

    @field_validator("livekit_url")
    @classmethod
    def validate_livekit_url(cls, v: str) -> str:
        if not v.startswith(("wss://", "ws://")):
            raise ValueError(
                f"LIVEKIT_URL must start with wss:// or ws://, got: {v!r}"
            )
        return v.rstrip("/")

    @field_validator("cartesia_sample_rate")
    @classmethod
    def validate_sample_rate(cls, v: int) -> int:
        allowed = {8000, 16000, 22050, 24000, 44100, 48000}
        if v not in allowed:
            raise ValueError(f"CARTESIA_SAMPLE_RATE must be one of {allowed}, got {v}")
        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return the singleton Settings instance.

    Cached after first call — reads .env only once per process lifetime.
    Call get_settings.cache_clear() in tests to reset.
    """
    return Settings()