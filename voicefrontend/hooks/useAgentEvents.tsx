'use client';
import { useEffect, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

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
function normaliseRole(raw: string): 'user' | 'assistant' | null {
    if (!raw) return null;
    const r = raw.toLowerCase();
    if (r === 'user' || r.endsWith('.user')) return 'user';
    if (r === 'assistant' || r.endsWith('.assistant')) return 'assistant';
    return null;
}
function normaliseState(raw: string): AgentState {
    if (!raw) return 'idle';
    const r = raw.toLowerCase();
    if (r.includes('listen')) return 'listening';
    if (r.includes('think')) return 'thinking';
    if (r.includes('speak')) return 'speaking';
    if (r.includes('init')) return 'initializing';
    return 'idle';
}
export function useAgentEvents(callbacks: AgentEventCallbacks) {
    const room = useRoomContext();
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
            if (topic !== 'agent-event') return;
            let msg: Record<string, unknown>;
            try {
                msg = JSON.parse(new TextDecoder().decode(payload));
            } catch {
                return;
            }
            const event = msg.event as string;
            if (event === 'user_input_transcribed') {
                cbRef.current.onTranscript?.({
                    transcript: (msg.transcript as string) ?? '',
                    isFinal: (msg.is_final as boolean) ?? false,
                });
            }
            if (event === 'agent_state_changed') {
                const newState = normaliseState((msg.new_state as string) ?? '');
                cbRef.current.onStateChange?.(newState);
            }
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