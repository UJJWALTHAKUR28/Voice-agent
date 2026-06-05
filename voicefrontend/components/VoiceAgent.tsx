// components/VoiceAgent.tsx
//
// Root component. Owns the LiveKit room connection and wires all subcomponents.
//
// FIX: agentTranscriptions from useVoiceAssistant is a CUMULATIVE array —
// it grows across the entire session. Previously we joined the whole array
// each time, so reply #2 would display reply #1's text + reply #2's text.
//
// Fix: record `transcriptStartIndex` when the agent transitions INTO
// 'speaking', then slice from that index so only the current utterance
// is shown in the streaming bubble.

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    LiveKitRoom,
    useVoiceAssistant,
    BarVisualizer,
    RoomAudioRenderer,
    VoiceAssistantControlBar,
} from '@livekit/components-react';
import '@livekit/components-styles';

import { ChatTranscript } from './ChatTranscript';
import { TextInput } from './TextInput';
import { StatusIndicator } from './StatusIndicator';
import { ClientToolHandler } from './ClientToolHandler';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useTranscript } from '../hooks/useTranscript';
import { useTextInput } from '../hooks/useTextInput';
import type { AgentState } from '@/hooks/useAgentEvents';
import type { ConversationItem } from '@/hooks/useAgentEvents';

// ── Token API ───────────────────────────────────────────────────────────────

interface TokenResponse { token: string; url: string; room: string; }

async function fetchToken(): Promise<TokenResponse> {
    const res = await fetch('/api/token');
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    return res.json();
}

// ── Inner session UI ────────────────────────────────────────────────────────

function AriaSession() {
    const { state: lkState, audioTrack, agentTranscriptions } = useVoiceAssistant();

    // Ground-truth agent state from LiveKit SDK
    const agentState = (lkState as AgentState) ?? 'idle';

    const { messages, interimText, addItem, updateInterim, addUserTyped } = useTranscript();
    const { sendText } = useTextInput();

    // Track last committed agent message to avoid duplicating streamed text
    const lastAgentMsg = useRef<string>('');

    // ── FIX: track where the current utterance starts in the cumulative array ──
    // agentTranscriptions never resets — it accumulates all words spoken since
    // the room was joined. We capture its length each time the agent begins a
    // new speaking turn, then slice from that index so only the current reply
    // is shown in the streaming bubble.
    const transcriptStartIndex = useRef<number>(0);
    const prevState = useRef<string>('');

    // ── Stream agent text as it speaks ─────────────────────────────────────
    useEffect(() => {
        if (!agentTranscriptions || agentTranscriptions.length === 0) return;

        // Slice to only the current utterance
        const currentChunks = agentTranscriptions.slice(transcriptStartIndex.current);
        const text = currentChunks.map(t => t.text).join('').trim();
        if (!text) return;

        setStreamingAgent(text);
    }, [agentTranscriptions]);

    // Streaming agent message state — shown while speaking, committed when done
    const [streamingAgentText, setStreamingAgent] = useState('');

    // State transition handler
    useEffect(() => {
        const wasNotSpeaking = prevState.current !== 'speaking';
        const nowSpeaking = agentState === 'speaking';
        const wasSpeaking = prevState.current === 'speaking';
        const nowNotSpeaking = agentState !== 'speaking';

        // Agent just STARTED speaking → record start index in cumulative array
        if (nowSpeaking && wasNotSpeaking) {
            transcriptStartIndex.current = agentTranscriptions?.length ?? 0;
            setStreamingAgent(''); // clear any leftover from last turn
        }

        // Agent just FINISHED speaking → commit the streamed text as a bubble
        if (wasSpeaking && nowNotSpeaking) {
            if (streamingAgentText.trim()) {
                const committed = streamingAgentText.trim();
                if (committed !== lastAgentMsg.current) {
                    lastAgentMsg.current = committed;
                    addItem({
                        role: 'assistant',
                        content: committed,
                        timestamp: Date.now(),
                        id: `agent-stream-${Date.now()}`,
                    } as ConversationItem);
                }
            }
            setStreamingAgent('');
        }

        prevState.current = agentState;
    }, [agentState, agentTranscriptions, streamingAgentText, addItem]);

    // ── DataPacket events from Python backend ───────────────────────────────
    useAgentEvents({
        onTranscript: (e) => {
            updateInterim(e.transcript, e.isFinal);
        },
        onStateChange: (_newState) => {
            // lkState from useVoiceAssistant is already authoritative.
        },
        onItemAdded: (item) => {
            if (item.role === 'user') {
                addItem(item);
            } else if (item.role === 'assistant') {
                if (item.content !== lastAgentMsg.current) {
                    lastAgentMsg.current = item.content;
                    setStreamingAgent('');
                    addItem(item);
                }
            }
        },
    });

    // ── Typed message handler ───────────────────────────────────────────────
    const handleSend = useCallback((text: string) => {
        addUserTyped(text);
        sendText(text);
    }, [addUserTyped, sendText]);

    const isConnected = lkState !== 'disconnected';

    // Build the messages list — inject streaming agent text as a live bubble
    const allMessages = streamingAgentText
        ? [
            ...messages,
            {
                role: 'assistant' as const,
                content: streamingAgentText,
                timestamp: Date.now(),
                id: 'streaming-now',
            },
        ]
        : messages;

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-lg)',
        }}>

            {/* ── Header ────────────────────────────────────────────────── */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderBottom: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        background: 'var(--accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        fontSize: '14px',
                        color: '#1a0f00',
                        boxShadow: agentState === 'speaking'
                            ? '0 0 0 3px var(--accent-glow), 0 0 16px var(--accent-glow)'
                            : 'none',
                        animation: agentState === 'speaking'
                            ? 'pulse-ring 1.6s ease infinite'
                            : 'none',
                        transition: 'box-shadow 0.3s ease',
                    }}>
                        J
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '0.01em' }}>
                            Jocasta
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            voice assistant
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        width: '60px',
                        height: '24px',
                        opacity: agentState === 'speaking' ? 1 : 0.2,
                        transition: 'opacity 0.3s ease',
                    }}>
                        <BarVisualizer
                            state={lkState}
                            trackRef={audioTrack}
                            barCount={8}
                            style={{ width: '100%', height: '100%' }}
                        />
                    </div>
                    <StatusIndicator state={agentState} />
                </div>
            </div>

            {/* ── Chat transcript ───────────────────────────────────────── */}
            <ChatTranscript
                messages={allMessages}
                interimText={interimText}
                agentState={agentState}
            />

            {/* ── Controls ──────────────────────────────────────────────── */}
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'center', borderBottom: '1px solid var(--border)' }}>
                    <VoiceAssistantControlBar />
                </div>
                <TextInput onSend={handleSend} disabled={!isConnected} />
            </div>

            <RoomAudioRenderer />
            <ClientToolHandler />
        </div>
    );
}

// ── Landing screen ──────────────────────────────────────────────────────────

function Landing({ onStart, loading, error }: { onStart: () => void; loading: boolean; error: string | null; }) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: '24px',
            padding: '48px 24px',
            textAlign: 'center',
        }}>
            <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                background: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                fontSize: '28px',
                color: '#1a0f00',
                boxShadow: '0 0 0 12px var(--accent-dim), var(--shadow-md)',
            }}>
                J
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h1 style={{ fontSize: '26px', fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Talk to Jocasta
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '280px', margin: 0, lineHeight: 1.6 }}>
                    Voice AI assistant — ask about weather, news, calculations, or anything else.
                </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center', maxWidth: '320px' }}>
                {['🌤 Weather', '📰 News', '🧮 Calculate', '💬 Chat'].map(cap => (
                    <span key={cap} style={{
                        padding: '5px 12px',
                        borderRadius: '9999px',
                        background: 'var(--bg-glass)',
                        border: '1px solid var(--border)',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        fontFamily: 'var(--font-mono)',
                    }}>
                        {cap}
                    </span>
                ))}
            </div>

            {error && (
                <p style={{
                    color: '#f87171',
                    fontSize: '13px',
                    maxWidth: '300px',
                    padding: '10px 16px',
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 'var(--radius-md)',
                    margin: 0,
                }}>
                    {error}
                </p>
            )}

            <button
                onClick={onStart}
                disabled={loading}
                style={{
                    padding: '13px 40px',
                    borderRadius: '9999px',
                    background: loading ? 'var(--bg-elevated)' : 'var(--accent)',
                    color: loading ? 'var(--text-muted)' : '#1a0f00',
                    border: 'none',
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--font-sans)',
                    letterSpacing: '-0.01em',
                    transition: 'opacity 0.2s, transform 0.15s',
                    boxShadow: loading ? 'none' : '0 4px 20px var(--accent-glow)',
                }}
                onMouseEnter={e => { if (!loading) (e.target as HTMLElement).style.transform = 'scale(1.03)'; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.transform = 'scale(1)'; }}
            >
                {loading ? 'Connecting…' : 'Start Conversation'}
            </button>

            <p style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                Mic access required · Works on Chrome + Firefox
            </p>
        </div>
    );
}

// ── Root export ─────────────────────────────────────────────────────────────

export function VoiceAgent() {
    const [conn, setConn] = useState<TokenResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startSession = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchToken();
            setConn(data);
        } catch {
            setError('Could not connect. Make sure the backend is running.');
        } finally {
            setLoading(false);
        }
    }, []);

    if (!conn) {
        return <Landing onStart={startSession} loading={loading} error={error} />;
    }

    return (
        <LiveKitRoom
            serverUrl={conn.url}
            token={conn.token}
            connect={true}
            audio={true}
            video={false}
            onDisconnected={() => setConn(null)}
            style={{ height: '100%', background: 'transparent' }}
        >
            <AriaSession />
        </LiveKitRoom>
    );
}