// hooks/useAgentEvents.ts
//
// Subscribes to LiveKit DataPacket messages from the Python agent and
// parses them into typed events for the UI.
//
// The Python backend (main.py) publishes on two topics:
//
//   topic="agent-event"  — state changes + transcript chunks
//     { event: "user_input_transcribed", transcript: string, is_final: boolean }
//     { event: "agent_state_changed", old_state: string, new_state: string }
//     { event: "conversation_item_added", role: "user"|"assistant", content: string }
//
//   topic="client-tool"  — browser-side actions
//     { type: "client_tool", action: string, data: object }
//     (handled separately in ClientToolHandler.tsx)

'use client';

import { useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

// ── Payload shapes ──────────────────────────────────────────────────────────

export type AgentState =
    | 'initializing' | 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TranscriptEvent {
    transcript: string;
    isFinal: boolean;
}

export interface ConversationItem {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    id: string;
}

interface AgentEventCallbacks {
    onTranscript?: (e: TranscriptEvent) => void;
    onStateChange?: (newState: AgentState) => void;
    onItemAdded?: (item: ConversationItem) => void;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAgentEvents(callbacks: AgentEventCallbacks) {
    const room = useRoomContext();

    useEffect(() => {
        if (!room) return;

        const handler = (
            payload: Uint8Array,
            _participant: unknown,
            _kind: unknown,
            topic?: string,
        ) => {
            // Only care about agent-event topic here
            if (topic !== 'agent-event') return;

            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(new TextDecoder().decode(payload));
            } catch {
                return;
            }

            const event = msg.event as string;

            if (event === 'user_input_transcribed') {
                callbacks.onTranscript?.({
                    transcript: (msg.transcript as string) ?? '',
                    isFinal: (msg.is_final as boolean) ?? false,
                });
            }

            if (event === 'agent_state_changed') {
                callbacks.onStateChange?.(msg.new_state as AgentState);
            }

            if (event === 'conversation_item_added') {
                const role = msg.role as 'user' | 'assistant';
                const content = msg.content as string;
                if (role && content?.trim()) {
                    callbacks.onItemAdded?.({
                        role,
                        content: content.trim(),
                        timestamp: Date.now(),
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    });
                }
            }
        };

        room.on(RoomEvent.DataReceived, handler);
        return () => { room.off(RoomEvent.DataReceived, handler); };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room]);
}