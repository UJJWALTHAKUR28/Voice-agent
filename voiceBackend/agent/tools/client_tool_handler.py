"""
Client tool handler — sends structured data messages to the browser frontend.

The agent can call `send_frontend_action` to push rich data (cards, links,
maps, etc.) to the connected browser participant via LiveKit data messages.

Supported action_type values:
  change_theme        payload: {"theme": "dark"|"light"}
  show_notification   payload: {"title": "...", "message": "...", "type": "info|success|warning|error"}
  open_url            payload: {"url": "https://..."}
  play_sound          payload: {"sound": "notification|success|error|click"}
  weather_card        payload: {
                          "city": "London, GB",
                          "temperature_c": 18.5,
                          "temperature_f": 65.3,
                          "feels_like_c": 16.2,
                          "description": "light rain",
                          "humidity_pct": 72,
                          "wind_kmh": 14.4,
                          "visibility_km": 8.0,
                          "weather_emoji": "🌧"
                      }
  calculator_card     payload: {
                          "expression": "sqrt(144) + 2**8",
                          "result": 268.0,
                          "formatted": "268"
                      }
"""

from __future__ import annotations

import json
import logging
from typing import Any

from livekit.agents import RunContext, function_tool
from livekit.agents.llm import ToolError

logger = logging.getLogger("voice-agent.client-tools")


@function_tool()
async def send_frontend_action(
    context: RunContext,
    action_type: str,
    payload: str,
) -> str:
    """Send a data message to the user's browser to trigger a frontend action.

    Use this to display rich visual content in the user's browser alongside
    your spoken response. Always call this AFTER narrating what you found.

    Action types and when to use them:
      weather_card      — After calling get_weather, send the result as a card.
                          payload must be the full weather result dict as JSON.
      calculator_card   — After calling calculate, send the result as a card.
                          payload must be: {"expression": "...", "result": 42, "formatted": "42"}
      change_theme      — Switch UI theme. payload: {"theme": "dark"} or {"theme": "light"}
      show_notification — Show a toast. payload: {"title": "...", "message": "...", "type": "info"}
      open_url          — Open a URL. payload: {"url": "https://..."}

    Args:
        action_type: One of: weather_card, calculator_card, change_theme,
                     show_notification, open_url, play_sound
        payload: A JSON-encoded string with the data for the action.
    """
    session = context.session
    
    if hasattr(session, "room_io") and session.room_io is not None:
        room = session.room_io.room
    else:
        room = getattr(session, "room", None)

    if room is None:
        raise ToolError("No LiveKit room connected — cannot send data to frontend.")

    # Validate payload is valid JSON
    try:
        payload_data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ToolError(f"payload must be valid JSON: {exc}") from exc

    message = json.dumps({
        "type": "client_tool",
        "action": action_type,
        "data": payload_data,
    })

    try:
        await room.local_participant.publish_data(
            payload=message.encode("utf-8"),
            topic="client-tool",
            reliable=True,
        )
        logger.info("frontend action sent action=%s", action_type)
    except Exception as exc:
        logger.error("frontend publish failed action=%s: %s", action_type, exc)
        raise ToolError(f"Failed to send action to frontend: {exc}") from exc

    return f"Successfully sent '{action_type}' action to the user's browser."