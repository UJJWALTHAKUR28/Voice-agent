'use client';
import { useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';
export function useTextInput() {
    const room = useRoomContext();
    const sendText = useCallback((text: string) => {
        if (!room || !text.trim()) return;
        const payload = JSON.stringify({ text: text.trim() });
        room.localParticipant.publishData(
            new TextEncoder().encode(payload),
            {
                topic: 'text-input',
                reliable: true,
            },
        );
    }, [room]);

    return { sendText };
}