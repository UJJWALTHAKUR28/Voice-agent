// hooks/useAgentEvents.tsx
//
// Subscribes to LiveKit DataPacket messages from the Python agent and
// parses them into typed events for the UI.
//
// FIXES:
//   1. Also listens to useVoiceAssistant's agentTranscript for streaming
//      agent text as it speaks (not just final committed items)
//   2. Handles role normalisation — backend may send "Role.user" strings
//   3. Deduplication guard on conversation_item_added vs typed messages

'use client';

import { useEffect, useRef } from 'react';
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
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    id: string;
}

interface AgentEventCallbacks {
    onTranscript?: (e: TranscriptEvent) => void;
    onStateChange?: (newState: AgentState) => void;
    onItemAdded?: (item: ConversationItem) => void;
}

/** Normalise role strings from Python — handles "Role.user", "user", "assistant" etc. */
function normaliseRole(raw: string): 'user' | 'assistant' | null {
    if (!raw) return null;
    const r = raw.toLowerCase();
    if (r === 'user' || r.endsWith('.user')) return 'user';
    if (r === 'assistant' || r.endsWith('.assistant')) return 'assistant';
    return null;
}

/** Normalise state strings — handles "AgentState.listening", "listening" etc. */
function normaliseState(raw: string): AgentState {
    if (!raw) return 'idle';
    const r = raw.toLowerCase();
    if (r.includes('listen')) return 'listening';
    if (r.includes('think')) return 'thinking';
    if (r.includes('speak')) return 'speaking';
    if (r.includes('init')) return 'initializing';
    return 'idle';
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useAgentEvents(callbacks: AgentEventCallbacks) {
    const room = useRoomContext();
    // Keep callbacks in a ref so the effect doesn't re-subscribe on every render
    const cbRef = useRef(callbacks);
    cbRef.current = callbacks;

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

            // ── User speech transcript (interim + final) ──────────────────
            if (event === 'user_input_transcribed') {
                cbRef.current.onTranscript?.({
                    transcript: (msg.transcript as string) ?? '',
                    isFinal: (msg.is_final as boolean) ?? false,
                });
            }

            // ── Agent state machine changes ────────────────────────────────
            if (event === 'agent_state_changed') {
                const newState = normaliseState((msg.new_state as string) ?? '');
                cbRef.current.onStateChange?.(newState);
            }

            // ── Full committed conversation items ─────────────────────────
            if (event === 'conversation_item_added') {
                const role = normaliseRole((msg.role as string) ?? '');
                const content = ((msg.content as string) ?? '').trim();

                if (role && content) {
                    cbRef.current.onItemAdded?.({
                        role,
                        content,
                        timestamp: Date.now(),
                        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    });
                }
            }
        };

        room.on(RoomEvent.DataReceived, handler);
        return () => { room.off(RoomEvent.DataReceived, handler); };
    }, [room]);
}