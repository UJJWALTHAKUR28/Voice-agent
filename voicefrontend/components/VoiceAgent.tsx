// components/VoiceAgent.tsx
//
// Root component. Owns the LiveKit room connection and wires all subcomponents.
//
// Architecture:
//   VoiceAgent           — fetches token, shows landing → connects room
//   └── LiveKitRoom      — provides room context to all children
//       └── AriaSession  — inner UI, subscribes to agent events
//           ├── StatusIndicator   — listening/thinking/speaking state
//           ├── BarVisualizer     — Aria's audio waveform
//           ├── ChatTranscript    — full message list + interim text
//           ├── TextInput         — typed message bar
//           ├── VoiceAssistantControlBar — mic toggle + disconnect
//           ├── RoomAudioRenderer — makes Aria's voice audible
//           └── ClientToolHandler — browser-side tool execution

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
    LiveKitRoom,
    useVoiceAssistant,
    BarVisualizer,
    RoomAudioRenderer,
    VoiceAssistantControlBar,
} from '@livekit/components-react';
import '@livekit/components-styles';

import { ChatTranscript } from './ChatTranscript'
import { TextInput } from './TextInput';
import { StatusIndicator } from './StatusIndicator';
import { ClientToolHandler } from './ClientToolHandler';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useTranscript } from '../hooks/useTranscript';
import { useTextInput } from '../hooks/useTextInput';
import type { AgentState } from '@/hooks/useAgentEvents';

// ── Token API response ──────────────────────────────────────────────────────

interface TokenResponse {
    token: string;
    url: string;
    room: string;
}

async function fetchToken(): Promise<TokenResponse> {
    const res = await fetch('/api/token');
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    return res.json();
}

// ── Inner session UI — rendered inside LiveKitRoom context ─────────────────

function AriaSession() {
    const { state: lkState, audioTrack } = useVoiceAssistant();

    // Map LiveKit's VoiceAssistantState to our AgentState type
    const agentState = (lkState as AgentState) ?? 'idle';

    const {
        messages,
        interimText,
        addItem,
        updateInterim,
        addUserTyped,
    } = useTranscript();

    const { sendText } = useTextInput();

    // Subscribe to all agent events
    useAgentEvents({
        onTranscript: (e) => {
            updateInterim(e.transcript, e.isFinal);
        },
        onStateChange: (_newState) => {
            // agentState already comes from useVoiceAssistant state —
            // this callback is available for additional logic if needed
        },
        onItemAdded: (item) => {
            addItem(item);
        },
    });

    // Handle typed message submit
    const handleSend = useCallback((text: string) => {
        // 1. Show immediately in transcript (optimistic)
        addUserTyped(text);
        // 2. Send to agent via DataPacket
        sendText(text);
    }, [addUserTyped, sendText]);

    const isConnected = lkState !== 'disconnected';

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
                {/* Aria identity */}
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
                        A
                    </div>
                    <div>
                        <div style={{
                            fontWeight: 600,
                            fontSize: '14px',
                            letterSpacing: '0.01em',
                        }}>Aria</div>
                        <div style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)',
                        }}>voice assistant</div>
                    </div>
                </div>

                {/* Status + waveform */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Waveform — only visible when speaking */}
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
                messages={messages}
                interimText={interimText}
                agentState={agentState}
            />

            {/* ── Controls row ──────────────────────────────────────────── */}
            <div style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
            }}>
                {/* Mic controls */}
                <div style={{
                    padding: '8px 16px',
                    display: 'flex',
                    justifyContent: 'center',
                    borderBottom: '1px solid var(--border)',
                }}>
                    <VoiceAssistantControlBar />
                </div>

                {/* Text input */}
                <TextInput
                    onSend={handleSend}
                    disabled={!isConnected}
                />
            </div>

            {/* Makes Aria's audio audible — must be inside room context */}
            <RoomAudioRenderer />
            {/* Executes browser-side tool commands from Aria */}
            <ClientToolHandler />
        </div>
    );
}

// ── Landing screen ─────────────────────────────────────────────────────────

function Landing({
    onStart,
    loading,
    error,
}: {
    onStart: () => void;
    loading: boolean;
    error: string | null;
}) {
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
            {/* Logo */}
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
                A
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <h1 style={{
                    fontSize: '26px',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                    margin: 0,
                }}>
                    Talk to Aria
                </h1>
                <p style={{
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    maxWidth: '280px',
                    margin: 0,
                    lineHeight: 1.6,
                }}>
                    Voice AI assistant — ask about weather, news,
                    calculations, or anything else.
                </p>
            </div>

            {/* Capabilities */}
            <div style={{
                display: 'flex',
                gap: '8px',
                flexWrap: 'wrap',
                justifyContent: 'center',
                maxWidth: '320px',
            }}>
                {['🌤 Weather', '📰 News', '🧮 Calculate', '📖 Wikipedia'].map(cap => (
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
                onMouseEnter={e => {
                    if (!loading) (e.target as HTMLElement).style.transform = 'scale(1.03)';
                }}
                onMouseLeave={e => {
                    (e.target as HTMLElement).style.transform = 'scale(1)';
                }}
            >
                {loading ? 'Connecting…' : 'Start Conversation'}
            </button>

            <p style={{
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
            }}>
                Mic access required · Works on Chrome + Firefox
            </p>
        </div>
    );
}

// ── Root VoiceAgent — public export ───────────────────────────────────────

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
        } catch (e) {
            setError('Could not connect. Make sure the backend is running on port 8000.');
        } finally {
            setLoading(false);
        }
    }, []);

    if (!conn) {
        return (
            <Landing
                onStart={startSession}
                loading={loading}
                error={error}
            />
        );
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