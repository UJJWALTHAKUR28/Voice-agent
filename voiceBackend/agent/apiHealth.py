"""
agent/api_health.py
───────────────────
Validates all external API keys at startup — one probe per service,
all fired concurrently, results logged as a clean status table.

Bugs fixed vs original:
  1. NewsAPI probe used /v2/top-headlines — paid-only endpoint. Free-tier
     keys always returned 401, making valid keys look broken. Fixed to
     /v2/everything which works on the free tier.

  2. Cartesia probe used API version header "2024-06-10" (outdated).
     Updated to "2025-04-16" to match current API.

  3. No LiveKit key check — lk_inference.LLM/STT/TTS all require
     LIVEKIT_API_KEY + LIVEKIT_API_SECRET. Added a lightweight probe.

  4. check_all_keys() returned bool but main.py never acted on it.
     Now returns (all_ok: bool, results: list[KeyResult]) so callers
     can decide whether to abort or warn.

  5. asyncio.run() in __main__ before agents.cli.run_app() is safe —
     they use separate event loops. No change needed there.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal

import httpx

from config.settings import get_settings
from utils.logging import get_logger

logger = get_logger(__name__)

_TIMEOUT = 4.0   # seconds per probe

Status = Literal["ok", "missing", "invalid", "expired", "unreachable", "unknown"]


@dataclass
class KeyResult:
    service:  str
    status:   Status
    detail:   str = field(default="")
    optional: bool = field(default=False)

    @property
    def healthy(self) -> bool:
        """True if this result should not block startup."""
        return self.status == "ok" or (self.optional and self.status == "missing")


# ── Generic probe ─────────────────────────────────────────────────────────────

async def _probe(
    client:  httpx.AsyncClient,
    service: str,
    url:     str,
    *,
    headers: dict[str, str] | None = None,
    params:  dict[str, str] | None = None,
    key:     str = "",
    optional: bool = False,
) -> KeyResult:
    """Fire one cheap HTTP request and map the response to a Status."""
    if not key or not key.strip():
        return KeyResult(service, "missing", optional=optional)
    try:
        r = await asyncio.wait_for(
            client.get(url, headers=headers or {}, params=params or {}),
            timeout=_TIMEOUT,
        )
        if r.status_code in (200, 201, 204):
            return KeyResult(service, "ok", optional=optional)
        if r.status_code == 429:
            # Rate-limited but key is valid
            return KeyResult(service, "ok", "rate-limited — key valid", optional=optional)
        if r.status_code == 401:
            return KeyResult(service, "expired", optional=optional)
        if r.status_code == 403:
            return KeyResult(service, "invalid", optional=optional)
        return KeyResult(service, "unknown", f"HTTP {r.status_code}", optional=optional)
    except (asyncio.TimeoutError, httpx.ConnectTimeout, httpx.ReadTimeout):
        return KeyResult(service, "unreachable", optional=optional)
    except Exception as exc:
        return KeyResult(service, "unknown", str(exc)[:80], optional=optional)


# ── Per-service probes ────────────────────────────────────────────────────────

async def _check_livekit(client: httpx.AsyncClient, api_key: str, api_secret: str) -> KeyResult:
    """
    LiveKit doesn't have a simple unauthenticated /health endpoint, so we
    do a lightweight check by verifying both env vars are non-empty.
    A deeper check would require the livekit SDK to create an access token —
    not worth the overhead at startup. If they're wrong, the agent will fail
    loudly on connect() anyway.
    """
    if not api_key or not api_secret:
        missing = "LIVEKIT_API_KEY" if not api_key else "LIVEKIT_API_SECRET"
        return KeyResult("livekit", "missing", f"{missing} not set")
    # Both set — treat as ok (connection errors surface at session start)
    return KeyResult("livekit", "ok", "credentials present")


async def _check_groq(client: httpx.AsyncClient, key: str) -> KeyResult:
    return await _probe(
        client, "groq",
        "https://api.groq.com/openai/v1/models",
        headers={"Authorization": f"Bearer {key}"},
        key=key,
    )


async def _check_deepgram(client: httpx.AsyncClient, key: str) -> KeyResult:
    return await _probe(
        client, "deepgram",
        "https://api.deepgram.com/v1/projects",
        headers={"Authorization": f"Token {key}"},
        key=key,
    )


async def _check_cartesia(client: httpx.AsyncClient, key: str) -> KeyResult:
    # FIX: updated API version from 2024-06-10 → 2025-04-16
    return await _probe(
        client, "cartesia",
        "https://api.cartesia.ai/voices",
        headers={"X-API-Key": key, "Cartesia-Version": "2025-04-16"},
        key=key,
    )


async def _check_openweather(client: httpx.AsyncClient, key: str) -> KeyResult:
    return await _probe(
        client, "openweather",
        "https://api.openweathermap.org/data/2.5/weather",
        params={"q": "London", "appid": key},
        key=key,
    )


async def _check_newsapi(client: httpx.AsyncClient, key: str) -> KeyResult:
    # FIX: was /v2/top-headlines — paid-only endpoint, always 401 on free tier.
    # /v2/everything works on free tier.
    return await _probe(
        client, "newsapi",
        "https://newsapi.org/v2/everything",
        params={"q": "test", "pageSize": "1", "apiKey": key},
        key=key,
    )


# ── Public entry point ────────────────────────────────────────────────────────

_ICON: dict[Status, str] = {
    "ok":          "✅",
    "missing":     "❌",
    "invalid":     "❌",
    "expired":     "❌",
    "unreachable": "⚠️ ",
    "unknown":     "⚠️ ",
}


async def check_all_keys() -> tuple[bool, list[KeyResult]]:
    """
    Probe all API keys concurrently. Logs a clean table. Returns
    (all_required_ok, results).

    Call once at startup — takes ~1-2s (network-bound).
    Never raises — all errors are caught and reflected in KeyResult.status.
    """
    s = get_settings()

    async with httpx.AsyncClient(
        timeout       = httpx.Timeout(_TIMEOUT, connect=2.0),
        follow_redirects = True,
        headers       = {"User-Agent": "VoiceAIAgent/1.0 (healthcheck)"},
    ) as client:
        results: list[KeyResult] = list(await asyncio.gather(
            _check_livekit(client,    s.livekit_api_key, s.livekit_api_secret),
            _check_groq(client,       s.groq_api_key),
            _check_deepgram(client,   s.deepgram_api_key),
            _check_cartesia(client,   s.cartesia_api_key),
            _check_openweather(client, s.openweather_api_key),
            _check_newsapi(client,    s.news_api_key),
        ))

    print()
    print("┌─────────────────────────────────────────────────────┐")
    print("│  API Key Health Check                               │")
    print("├──────────────┬──────────────┬───────────────────────┤")
    print("│  Service     │  Status      │  Detail               │")
    print("├──────────────┼──────────────┼───────────────────────┤")
    for r in results:
        icon   = _ICON[r.status]
        detail = r.detail[:21] if r.detail else ""
        opt    = " (opt)" if r.optional and r.status == "missing" else ""
        print(f"│  {r.service:<12}│  {icon} {r.status:<8}{opt:<2}│  {detail:<21}│")
    print("└──────────────┴──────────────┴───────────────────────┘")

    all_ok = all(r.healthy for r in results)

    if not all_ok:
        failed = [r.service for r in results if not r.healthy]
        print(f"\n  ❌  Required keys failing: {', '.join(failed)}")
        print("     Fix these in .env before starting the agent.\n")
    else:
        print("\n  ✅  All required API keys OK\n")

    return all_ok, results