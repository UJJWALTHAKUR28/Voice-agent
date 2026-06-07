'use client';
import { useState, useCallback, useRef } from 'react';
import type { ConversationItem } from './useAgentEvents';
const AGENT_DEDUP_WINDOW_MS = 10_000;
const AGENT_DEDUP_HISTORY = 5;
interface AgentMsgRecord {
    content: string;
    timestamp: number;
    id: string;
}
function norm(s: string): string {
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
function isPrefix(shorter: string, longer: string): boolean {
    const a = norm(shorter);
    const b = norm(longer);
    if (a === b) return true;
    if (b.startsWith(a) && a.length >= 40) return true;
    return false;
}
function isSimilar(a: string, b: string): boolean {
    const na = norm(a);
    const nb = norm(b);
    if (na === nb) return true;
    if (isPrefix(na, nb) || isPrefix(nb, na)) return true;
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length < nb.length ? nb : na;
    if (shorter.length / longer.length >= 0.85 && longer.startsWith(shorter.slice(0, Math.floor(shorter.length * 0.9)))) {
        return true;
    }
    return false;
}
export function useTranscript() {
    const [messages, setMessages] = useState<ConversationItem[]>([]);
    const [interimText, setInterimText] = useState('');
    const recentTyped = useRef<Set<string>>(new Set());
    const recentAgentMsgs = useRef<AgentMsgRecord[]>([]);
    function classifyAgentMsg(content: string): 'add' | 'skip' | { replace: string } {
        const now = Date.now();
        const cutoff = now - AGENT_DEDUP_WINDOW_MS;
        recentAgentMsgs.current = recentAgentMsgs.current.filter(r => r.timestamp > cutoff);
        for (const record of recentAgentMsgs.current) {
            if (isSimilar(content, record.content)) {
                if (norm(content).length > norm(record.content).length + 10) {
                    return { replace: record.id };
                }
                return 'skip';
            }
        }

        return 'add';
    }

    function trackAgentMsg(id: string, content: string) {
        recentAgentMsgs.current.push({ id, content, timestamp: Date.now() });
        if (recentAgentMsgs.current.length > AGENT_DEDUP_HISTORY) {
            recentAgentMsgs.current.shift();
        }
    }
    const addItem = useCallback((item: ConversationItem) => {
        if (item.role === 'user') {
            if (recentTyped.current.has(item.content)) {
                recentTyped.current.delete(item.content);
                return;
            }
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'user' && last.content === item.content && item.timestamp - last.timestamp < 2000) {
                    return prev;
                }
                return [...prev, item];
            });
            setInterimText('');
            return;
        }
        if (item.role === 'assistant') {
            const decision = classifyAgentMsg(item.content);
            if (decision === 'skip') {
                return;
            }
            if (typeof decision === 'object' && 'replace' in decision) {
                const replaceId = decision.replace;
                setMessages(prev => prev.map(m =>
                    m.id === replaceId
                        ? { ...item, id: replaceId }
                        : m
                ));
                const rec = recentAgentMsgs.current.find(r => r.id === replaceId);
                if (rec) { rec.content = item.content; rec.timestamp = Date.now(); }
                return;
            }
            trackAgentMsg(item.id, item.content);
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && last.content === item.content && item.timestamp - last.timestamp < 2000) {
                    return prev;
                }
                return [...prev, item];
            });
            return;
        }
        setMessages(prev => [...prev, item]);
    }, []);
    const updateInterim = useCallback((text: string, isFinal: boolean) => {
        if (isFinal) {
            setInterimText('');
        } else {
            setInterimText(text);
        }
    }, []);
    const addUserTyped = useCallback((text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;

        recentTyped.current.add(trimmed);
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
        recentAgentMsgs.current = [];
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