// components/ChatTranscript.tsx
//
// Renders the full conversation transcript:
//   - Committed messages (user voice, user typed, agent replies)
//   - Live interim text — grey + italic, updates every ~200ms as user speaks
//   - Timestamps on each bubble
//   - Auto-scrolls to the newest message
//
// Message bubbles:
//   User  → right-aligned, dark blue tint
//   Agent → left-aligned, darker, with Aria avatar dot

'use client';

import { useEffect, useRef } from 'react';
import type { ConversationItem } from '../hooks/useAgentEvents';

interface ChatTranscriptProps {
    messages: ConversationItem[];
    interimText: string;             // live speech — shown as ghost bubble
    agentState: string;
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function UserBubble({ item }: { item: ConversationItem }) {
    return (
        <div className="fade-up" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '4px',
        }}>
            <div style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: 'var(--radius-lg) var(--radius-lg) 4px var(--radius-lg)',
                background: 'var(--user-bubble)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontSize: '14px',
                lineHeight: 1.55,
                wordBreak: 'break-word',
            }}>
                {item.content}
            </div>
            <span style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                paddingRight: '4px',
            }}>
                {formatTime(item.timestamp)}
            </span>
        </div>
    );
}

function AgentBubble({ item }: { item: ConversationItem }) {
    return (
        <div className="fade-up" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '4px',
        }}>
            {/* Avatar + content row */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                {/* Aria dot */}
                <div style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    flexShrink: 0,
                    marginBottom: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                }}>
                    A
                </div>

                <div style={{
                    maxWidth: '75%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px',
                    background: 'var(--agent-bubble)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: '14px',
                    lineHeight: 1.6,
                    wordBreak: 'break-word',
                }}>
                    {item.content}
                </div>
            </div>

            <span style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                paddingLeft: '32px',
            }}>
                {formatTime(item.timestamp)}
            </span>
        </div>
    );
}

// The live interim bubble — shown while user is speaking
function InterimBubble({ text }: { text: string }) {
    if (!text) return null;
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
        }}>
            <div style={{
                maxWidth: '75%',
                padding: '10px 14px',
                borderRadius: 'var(--radius-lg) var(--radius-lg) 4px var(--radius-lg)',
                background: 'var(--user-bubble)',
                border: '1px dashed var(--border-strong)',
                color: 'var(--text-muted)',
                fontSize: '14px',
                lineHeight: 1.55,
                fontStyle: 'italic',
            }}>
                {text}
                <span className="cursor-blink" style={{ marginLeft: '2px', color: 'var(--accent)' }}>|</span>
            </div>
        </div>
    );
}

// Thinking indicator — three dots while agent processes
function ThinkingBubble() {
    return (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: 'var(--accent)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px',
            }}>A</div>
            <div style={{
                padding: '12px 16px',
                borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-lg) 4px',
                background: 'var(--agent-bubble)',
                border: '1px solid var(--border)',
                display: 'flex', gap: '5px', alignItems: 'center',
            }}>
                {[0, 0.2, 0.4].map((delay, i) => (
                    <span key={i} className="shimmer" style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: 'var(--text-muted)',
                        animationDelay: `${delay}s`,
                        display: 'block',
                    }} />
                ))}
            </div>
        </div>
    );
}

export function ChatTranscript({ messages, interimText, agentState }: ChatTranscriptProps) {
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto-scroll on any change
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, interimText, agentState]);

    const isEmpty = messages.length === 0 && !interimText;

    return (
        <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
        }}>
            {/* Empty state */}
            {isEmpty && (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px',
                    opacity: 0.5,
                    paddingTop: '60px',
                }}>
                    <div style={{ fontSize: '36px' }}>🎤</div>
                    <p style={{
                        fontSize: '13px',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'center',
                    }}>
                        Speak or type to start
                    </p>
                </div>
            )}

            {/* Committed messages */}
            {messages.map(item => (
                item.role === 'user'
                    ? <UserBubble key={item.id} item={item} />
                    : <AgentBubble key={item.id} item={item} />
            ))}

            {/* Live interim speech */}
            {interimText && <InterimBubble text={interimText} />}

            {/* Agent thinking indicator */}
            {agentState === 'thinking' && <ThinkingBubble />}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
        </div>
    );
}