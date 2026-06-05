// hooks/useTranscript.tsx
//
// Manages the full conversation transcript — committed messages + live interim.
//
// FIXES:
//   1. Smarter deduplication — user typed messages don't get doubled when
//      backend echoes them back as conversation_item_added
//   2. Agent streaming text: separate agentStreamText state updated as the
//      agent speaks (from useVoiceAssistant agentTranscript)
//   3. Clear interim text properly when final transcript arrives

'use client';

import { useState, useCallback, useRef } from 'react';
import type { ConversationItem } from './useAgentEvents';

export function useTranscript() {
    const [messages, setMessages] = useState<ConversationItem[]>([]);
    const [interimText, setInterimText] = useState('');

    // Track recently-typed messages to suppress backend echoes
    const recentTyped = useRef<Set<string>>(new Set());

    const addItem = useCallback((item: ConversationItem) => {
        setMessages(prev => {
            // If this is a backend echo of something we already added optimistically, skip it
            if (item.role === 'user' && recentTyped.current.has(item.content)) {
                recentTyped.current.delete(item.content);
                return prev;
            }

            // Deduplicate: same role + same content within 2 seconds
            const last = prev[prev.length - 1];
            if (
                last?.role === item.role &&
                last?.content === item.content &&
                item.timestamp - last.timestamp < 2000
            ) {
                return prev;
            }

            return [...prev, item];
        });

        // Clear interim when a committed user message arrives
        if (item.role === 'user') {
            setInterimText('');
        }
    }, []);

    const updateInterim = useCallback((text: string, isFinal: boolean) => {
        if (isFinal) {
            // Final — the conversation_item_added event will commit it
            setInterimText('');
        } else {
            setInterimText(text);
        }
    }, []);

    // Called when user submits typed text — adds optimistically to the list
    const addUserTyped = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        // Mark as typed so we can suppress the backend echo
        recentTyped.current.add(trimmed);
        // Clean up after 5 seconds in case the echo never comes
        setTimeout(() => recentTyped.current.delete(trimmed), 5000);

        const item: ConversationItem = {
            role: 'user',
            content: trimmed,
            timestamp: Date.now(),
            id: `typed-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        };
        setMessages(prev => [...prev, item]);
    }, []);

    const clear = useCallback(() => {
        setMessages([]);
        setInterimText('');
        recentTyped.current.clear();
    }, []);

    return {
        messages,
        interimText,
        addItem,
        updateInterim,
        addUserTyped,
        clear,
    };
}