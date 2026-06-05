// hooks/useTranscript.ts
//
// Manages the full conversation transcript — both committed messages
// (conversation_item_added) and the live interim transcript that appears
// as the user speaks in real time.
//
// State shape:
//   messages    — committed messages shown in the chat log
//   interimText — live grey text showing what the user is currently saying
//                 (updates every ~200ms while speaking, cleared on is_final)

'use client';

import { useState, useCallback, useRef } from 'react';
import type { ConversationItem } from './useAgentEvents';

export interface TranscriptState {
    messages: ConversationItem[];
    interimText: string;              // live speech, not yet committed
}

export function useTranscript() {
    const [messages, setMessages] = useState<ConversationItem[]>([]);
    const [interimText, setInterimText] = useState('');

    // Track last user message id so we can deduplicate:
    // conversation_item_added fires for the final user message — but we
    // may have already shown it via interim. We don't want two copies.
    const lastUserContent = useRef<string>('');

    const addItem = useCallback((item: ConversationItem) => {
        setMessages(prev => {
            // Deduplicate: if the same content was just added, skip
            const last = prev[prev.length - 1];
            if (last?.role === item.role && last?.content === item.content) {
                return prev;
            }
            return [...prev, item];
        });

        if (item.role === 'user') {
            lastUserContent.current = item.content;
            setInterimText('');  // clear interim once final is committed
        }
    }, []);

    const updateInterim = useCallback((text: string, isFinal: boolean) => {
        if (isFinal) {
            // Final transcript — the conversation_item_added event will add
            // the committed message. We just clear interim here.
            setInterimText('');
        } else {
            // Interim — show as live grey text while user is still speaking
            setInterimText(text);
        }
    }, []);

    // Called when user sends a typed message (before agent responds)
    // We add it to the transcript immediately without waiting for backend echo
    const addUserTyped = useCallback((text: string) => {
        const item: ConversationItem = {
            role: 'user',
            content: text,
            timestamp: Date.now(),
            id: `typed-${Date.now()}`,
        };
        lastUserContent.current = text;
        setMessages(prev => [...prev, item]);
    }, []);

    const clear = useCallback(() => {
        setMessages([]);
        setInterimText('');
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