// hooks/useTextInput.ts
//
// Sends a typed message to the Python agent via a LiveKit DataPacket.
//
// The agent (main.py) listens on topic="text-input" and calls:
//   session.generate_reply(user_input=text)
//
// This feeds into the exact same pipeline as voice — same LLM, same TTS,
// same streaming text response. User types → agent speaks + streams text.

'use client';

import { useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';

export function useTextInput() {
    const room = useRoomContext();

    const sendText = useCallback((text: string) => {
        if (!room || !text.trim()) return;

        const payload = JSON.stringify({ text: text.trim() });

        // publish_data is synchronous in livekit-client (no await needed)
        room.localParticipant.publishData(
            new TextEncoder().encode(payload),
            {
                topic: 'text-input',
                reliable: true,   // TCP-like delivery — not fire-and-forget
            },
        );
    }, [room]);

    return { sendText };
}