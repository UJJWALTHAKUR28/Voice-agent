"""
Client tool handler — sends structured data messages to the browser frontend.

The agent can call `send_frontend_action` to push rich data (cards, links,
maps, etc.) to the connected browser participant via LiveKit data messages.
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

    Use this when you want to display rich content (a weather card, a map,
    a Wikipedia link, a notification, etc.) in the user's browser alongside
    your spoken response.

    Args:
        action_type: The kind of action, e.g. "weather_card", "wiki_card",
                     "notification", "open_link".
        payload: A JSON-encoded string with the data for the action.
    """
    session = context.session
    room = session.room

    if room is None:
        raise ToolError("No LiveKit room is connected — cannot send data to the frontend.")

    # Validate payload is valid JSON
    try:
        payload_data = json.loads(payload)
    except json.JSONDecodeError:
        raise ToolError(
            "The payload must be valid JSON. "
            f"Received: {payload[:200]}"
        )

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
        logger.info("Sent frontend action '%s' to room", action_type)
    except Exception as exc:
        logger.exception("Failed to publish data message")
        raise ToolError(f"Failed to send action to frontend: {exc}") from exc

    return f"Successfully sent '{action_type}' action to the user's browser."
