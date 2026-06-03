"""
tts/cartesia_tts.py
───────────────────
Cartesia TTS wrapper — low-latency, streaming text-to-speech via Cartesia's API.

Cartesia is chosen over Kokoro because:
  - Sub-100ms TTFB (time-to-first-byte) on their sonic-2 model
  - True streaming: audio chunks start arriving before synthesis completes
  - No local GPU required — pure API call
  - Excellent voice quality with emotion/style control
  - Free tier covers typical dev usage

This module provides a LiveKit Agents v1.5.x compatible TTS class that wraps
the Cartesia WebSocket streaming API. Audio is streamed into the LiveKit voice
pipeline as PCM frames with the lowest possible latency.

Architecture:
  CartesiaTTS       — TTS plugin class registered with LiveKit
  CartesiaTTSStream — ChunkedStream that manages one synthesis request
  _CartesiaWSClient — Low-level WebSocket client to Cartesia's streaming API

Wire format:
  We connect to Cartesia's WebSocket endpoint, send a JSON "tts.input" message,
  and receive a stream of "tts.output" messages containing base64-encoded PCM
  chunks. Each chunk is decoded and pushed into LiveKit's AudioEmitter.

Environment variables (all overridable in constructor):
  CARTESIA_API_KEY         — required
  CARTESIA_MODEL           — default: sonic-2
  CARTESIA_VOICE_ID        — default: warm female voice
  CARTESIA_LANGUAGE        — default: en
  CARTESIA_SAMPLE_RATE     — default: 24000
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from typing import AsyncIterator

import aiohttp

from livekit.agents import tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions
from livekit.agents.utils import shortuuid

logger = logging.getLogger("voice-agent.cartesia-tts")

# Cartesia WebSocket streaming endpoint
_CARTESIA_WS_URL = "wss://api.cartesia.ai/tts/websocket"
_CARTESIA_HTTP_URL = "https://api.cartesia.ai/tts/bytes"
_CARTESIA_API_VERSION = "2024-06-10"

# PCM output config — must match what we tell LiveKit
_NUM_CHANNELS = 1


class CartesiaTTS(tts.TTS):
    """
    LiveKit-compatible TTS plugin backed by Cartesia's sonic-2 model.

    Supports true streaming: audio chunks are pushed to LiveKit as they
    arrive from Cartesia's WebSocket, achieving TTFB under 200ms on most
    inputs.

    Args:
        api_key:     Cartesia API key (falls back to CARTESIA_API_KEY env var)
        model:       Model ID, default "sonic-2" (lowest latency)
        voice_id:    Cartesia voice UUID
        language:    BCP-47 language code, default "en"
        sample_rate: Output PCM sample rate (8000–48000)
        speed:       Speaking rate — "slowest"|"slow"|"normal"|"fast"|"fastest"
                     or a float 0.5–2.0 (default "normal")
        emotion:     List of emotion tags e.g. ["positivity:high", "curiosity"]
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        voice_id: str | None = None,
        language: str | None = None,
        sample_rate: int | None = None,
        speed: str | float = "normal",
        emotion: list[str] | None = None,
    ) -> None:
        self._api_key = api_key or os.environ.get("CARTESIA_API_KEY", "")
        if not self._api_key:
            raise ValueError(
                "Cartesia API key is required. Set CARTESIA_API_KEY or pass api_key=..."
            )

        self._model = model or os.environ.get("CARTESIA_MODEL", "sonic-2")
        self._voice_id = voice_id or os.environ.get(
            "CARTESIA_VOICE_ID", "694f9389-aac1-45b6-b726-9d9369183238"
        )
        self._language = language or os.environ.get("CARTESIA_LANGUAGE", "en")
        self._sample_rate = sample_rate or int(
            os.environ.get("CARTESIA_SAMPLE_RATE", "24000")
        )
        self._speed = speed
        self._emotion = emotion or []

        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=True),
            sample_rate=self._sample_rate,
            num_channels=_NUM_CHANNELS,
        )

        logger.info(
            "CartesiaTTS initialised model=%s voice=%s sample_rate=%d",
            self._model,
            self._voice_id,
            self._sample_rate,
        )

    def update_options(
        self,
        *,
        voice_id: str | None = None,
        speed: str | float | None = None,
        emotion: list[str] | None = None,
    ) -> None:
        """Hot-swap voice/speed/emotion at runtime (takes effect on next synthesis)."""
        if voice_id is not None:
            self._voice_id = voice_id
        if speed is not None:
            self._speed = speed
        if emotion is not None:
            self._emotion = emotion

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "CartesiaTTSStream":
        return CartesiaTTSStream(
            tts=self,
            text=text,
            conn_options=conn_options,
        )


class CartesiaTTSStream(tts.ChunkedStream):
    """
    One synthesis request to Cartesia.

    Opens a WebSocket, sends the text, and pushes PCM chunks into LiveKit's
    AudioEmitter as they arrive. The WebSocket is closed after the done signal.
    """

    def __init__(
        self,
        *,
        tts: CartesiaTTS,
        text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=text, conn_options=conn_options)
        self._tts_ref: CartesiaTTS = tts  # typed reference

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        tts_inst = self._tts_ref
        request_id = shortuuid()

        output_emitter.initialize(
            request_id=request_id,
            sample_rate=tts_inst._sample_rate,
            num_channels=_NUM_CHANNELS,
            mime_type="audio/pcm",
            stream=True,
        )

        # Build voice control object
        voice_control: dict = {"id": tts_inst._voice_id, "mode": "id"}
        if tts_inst._speed != "normal":
            voice_control["__experimental_controls"] = {
                "speed": tts_inst._speed,
                "emotion": tts_inst._emotion,
            }
        elif tts_inst._emotion:
            voice_control["__experimental_controls"] = {
                "emotion": tts_inst._emotion,
            }

        # Build output format
        output_format = {
            "container": "raw",
            "encoding": "pcm_s16le",
            "sample_rate": tts_inst._sample_rate,
        }

        # Request payload
        payload = {
            "model_id": tts_inst._model,
            "transcript": self._input_text,
            "voice": voice_control,
            "output_format": output_format,
            "language": tts_inst._language,
            "add_timestamps": False,
            "context_id": request_id,
        }

        headers = {
            "X-API-Key": tts_inst._api_key,
            "Cartesia-Version": _CARTESIA_API_VERSION,
        }

        ws_url = (
            f"{_CARTESIA_WS_URL}"
            f"?api_key={tts_inst._api_key}"
            f"&cartesia_version={_CARTESIA_API_VERSION}"
        )

        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(
                    ws_url,
                    headers=headers,
                    heartbeat=30,
                ) as ws:
                    # Send synthesis request
                    await ws.send_str(json.dumps(payload))
                    logger.debug(
                        "cartesia.ws.sent request_id=%s text_len=%d",
                        request_id,
                        len(self._input_text),
                    )

                    # Receive and forward audio chunks
                    async for msg in ws:
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            data = json.loads(msg.data)
                            msg_type = data.get("type", "")

                            if msg_type == "chunk":
                                # Raw PCM chunk encoded as base64
                                audio_b64 = data.get("data", "")
                                if audio_b64:
                                    pcm_bytes = base64.b64decode(audio_b64)
                                    output_emitter.push(pcm_bytes)

                            elif msg_type == "done":
                                logger.debug(
                                    "cartesia.ws.done request_id=%s", request_id
                                )
                                break

                            elif msg_type == "error":
                                err = data.get("error", "Unknown Cartesia error")
                                logger.error(
                                    "cartesia.ws.error request_id=%s error=%s",
                                    request_id,
                                    err,
                                )
                                raise RuntimeError(f"Cartesia synthesis error: {err}")

                        elif msg.type in (
                            aiohttp.WSMsgType.CLOSE,
                            aiohttp.WSMsgType.ERROR,
                        ):
                            logger.warning(
                                "cartesia.ws.closed unexpectedly request_id=%s",
                                request_id,
                            )
                            break

            output_emitter.flush()
            logger.debug("cartesia.stream.done request_id=%s", request_id)

        except asyncio.CancelledError:
            # Pipeline cancelled (e.g. user interrupted) — normal, not an error
            logger.debug("cartesia.stream.cancelled request_id=%s", request_id)
            raise

        except Exception:
            logger.exception(
                "cartesia.stream.failed request_id=%s text=%r",
                request_id,
                self._input_text[:80],
            )
            raise