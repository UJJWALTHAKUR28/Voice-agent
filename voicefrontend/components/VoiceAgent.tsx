'use client';

// components/VoiceAgent.tsx
// Full-screen Jocasta voice interface
// Orb visualiser: sphere → pulse when agent speaks, subtle idle rotation
// Transcript: slides up from bottom like Siri/ChatGPT Advanced Voice
// Controls: minimal floating bar at bottom

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    LiveKitRoom,
    useVoiceAssistant,
    BarVisualizer,
    RoomAudioRenderer,
    VoiceAssistantControlBar,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';

import { ChatTranscript } from './ChatTranscript';
import { TextInput } from './TextInput';
import { ClientToolHandler } from './ClientToolHandler';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useTranscript } from '../hooks/useTranscript';
import { useTextInput } from '../hooks/useTextInput';
import type { AgentState, ConversationItem } from '@/hooks/useAgentEvents';

/* ── Types ───────────────────────────────────────────────────────────────── */
interface TokenResponse { token: string; url: string; room: string; }

async function fetchToken(): Promise<TokenResponse> {
    const res = await fetch('/api/token');
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    return res.json();
}

/* ── Agent Sphere Visualiser ─────────────────────────────────────────────── */
// The centrepiece — replaces the LiveKit BarVisualizer with the orb sphere
function AgentOrb({ state }: { state: AgentState }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const timeRef = useRef(0);
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const W = 280, H = 280;
        canvas.width = W; canvas.height = H;
        const cx = W / 2, cy = H / 2, R = 100;

        /* Build fibonacci lattice */
        const N = 140;
        const golden = Math.PI * (3 - Math.sqrt(5));
        const nodes: { x: number; y: number; z: number }[] = [];
        for (let i = 0; i < N; i++) {
            const y = 1 - (i / (N - 1)) * 2;
            const r = Math.sqrt(1 - y * y);
            const theta = golden * i;
            nodes.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
        }
        const edges: [number, number][] = [];
        for (let i = 0; i < N; i++) {
            for (let j = i + 1; j < N; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const dz = nodes[i].z - nodes[j].z;
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.42) edges.push([i, j]);
            }
        }

        let pulseT = 0;
        let breatheT = 0;

        function draw() {
            const s = stateRef.current;
            const isSpeaking = s === 'speaking';
            const isListening = s === 'listening';
            const isThinking = s === 'thinking';

            const baseSpeed = isSpeaking ? 0.007 : isListening ? 0.005 : isThinking ? 0.003 : 0.002;
            timeRef.current += baseSpeed;
            pulseT += isSpeaking ? 0.08 : 0.025;
            breatheT += 0.02;

            const breatheScale = 1 + Math.sin(breatheT) * (isSpeaking ? 0.06 : 0.02);
            const angle = timeRef.current;
            const tiltX = 0.3;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
            const Rb = R * breatheScale;

            ctx.clearRect(0, 0, W, H);

            function project(nx: number, ny: number, nz: number) {
                const rx = nx * cosA + nz * sinA;
                const ry = ny;
                const rz = -nx * sinA + nz * cosA;
                const fy = ry * cosX - rz * sinX;
                const fz = ry * sinX + rz * cosX;
                const fov = 380;
                const sc = fov / (fov + fz * Rb);
                return { px: cx + rx * Rb * sc, py: cy + fy * Rb * sc, z: fz, scale: sc };
            }

            /* Glow halo */
            const haloAlpha = isSpeaking ? 0.15 : isListening ? 0.07 : 0.03;
            const halo = ctx.createRadialGradient(cx, cy, Rb * 0.4, cx, cy, Rb * 1.5);
            halo.addColorStop(0, `rgba(200,146,42,${haloAlpha})`);
            halo.addColorStop(1, 'rgba(200,146,42,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(0, 0, W, H);

            /* Edges */
            for (const [a, b] of edges) {
                const pA = project(nodes[a].x, nodes[a].y, nodes[a].z);
                const pB = project(nodes[b].x, nodes[b].y, nodes[b].z);
                const vis = ((pA.z + pB.z) / 2 + 1) / 2;
                const baseAlpha = isSpeaking ? 0.6 : isListening ? 0.45 : 0.22;
                const alpha = vis * baseAlpha;
                const grd = ctx.createLinearGradient(pA.px, pA.py, pB.px, pB.py);
                grd.addColorStop(0, `rgba(200,146,42,${alpha * 0.6})`);
                grd.addColorStop(0.5, `rgba(232,172,68,${alpha})`);
                grd.addColorStop(1, `rgba(200,146,42,${alpha * 0.6})`);
                ctx.beginPath();
                ctx.moveTo(pA.px, pA.py);
                ctx.lineTo(pB.px, pB.py);
                ctx.strokeStyle = grd;
                ctx.lineWidth = vis * (isSpeaking ? 0.85 : 0.5);
                ctx.stroke();
            }

            /* Nodes */
            for (let i = 0; i < N; i++) {
                const p = project(nodes[i].x, nodes[i].y, nodes[i].z);
                const vis = (p.z + 1) / 2;
                const r = vis * (isSpeaking ? 2.1 : 1.6);
                const alpha = vis * (isSpeaking ? 0.95 : isListening ? 0.75 : 0.45);
                ctx.beginPath();
                ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(232,172,68,${alpha})`;
                ctx.fill();
                /* Halo for bright front nodes */
                if ((isSpeaking || isListening) && vis > 0.8) {
                    ctx.beginPath();
                    ctx.arc(p.px, p.py, r * 2.8, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(200,146,42,${alpha * 0.08})`;
                    ctx.fill();
                }
            }

            /* Pulse rings when speaking */
            if (isSpeaking) {
                for (let ring = 0; ring < 4; ring++) {
                    const phase = (pulseT * 0.35 + ring * 0.65) % 1;
                    const rr = Rb * (0.85 + phase * 0.75);
                    const al = (1 - phase) * 0.22;
                    ctx.beginPath();
                    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(200,146,42,${al})`;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }

            /* Thinking: rotating dashed arc */
            if (isThinking) {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(timeRef.current * 6);
                ctx.beginPath();
                ctx.arc(0, 0, Rb * 1.12, 0, Math.PI * 1.4);
                ctx.strokeStyle = 'rgba(157,123,234,0.4)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([5, 8]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            /* Listening: soft outer ring */
            if (isListening) {
                ctx.beginPath();
                ctx.arc(cx, cy, Rb * 1.08, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(45,212,160,${0.18 + Math.sin(pulseT * 3) * 0.08})`;
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            animRef.current = requestAnimationFrame(draw);
        }

        animRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animRef.current);
    }, []);

    const stateColors: Record<AgentState, string> = {
        initializing: '#c8922a',
        idle: '#3a3a4e',
        listening: '#2dd4a0',
        thinking: '#9d7bea',
        speaking: '#5ba4f5',
    };

    return (
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <canvas ref={canvasRef} style={{ width: '280px', height: '280px', maxWidth: '52vw', maxHeight: '52vw' }} />
            {/* State label under orb */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '5px 14px',
                borderRadius: '100px',
                border: '1px solid var(--border-mid)',
                background: 'var(--bg-glass)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
            }}>
                <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: stateColors[state] ?? '#3a3a4e',
                    boxShadow: `0 0 8px ${stateColors[state] ?? '#3a3a4e'}80`,
                    animation: state === 'speaking' || state === 'listening' ? 'pulse-soft 1.8s ease infinite' : 'none',
                }} />
                <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '11px',
                    color: stateColors[state] ?? 'var(--text-muted)',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                }}>
                    {state === 'initializing' ? 'Initialising' :
                        state === 'idle' ? 'Ready' :
                            state === 'listening' ? 'Listening' :
                                state === 'thinking' ? 'Processing' :
                                    'Speaking'}
                </span>
            </div>
        </div>
    );
}

/* ── Transcript Panel ─────────────────────────────────────────────────────── */
// Slides up from the bottom; hidden when empty
function TranscriptPanel({
    messages, interimText, agentState, onClose
}: {
    messages: ConversationItem[];
    interimText: string;
    agentState: AgentState;
    onClose: () => void;
}) {
    const bottomRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, interimText, agentState]);

    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: '12px',
            overflowY: 'auto', padding: '16px 0 8px',
            maxHeight: '100%',
        }}>
            {messages.map(item => (
                <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                        display: 'flex',
                        justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start',
                    }}
                >
                    <div style={{
                        maxWidth: '78%',
                        padding: '10px 14px',
                        borderRadius: item.role === 'user'
                            ? 'var(--r-lg) var(--r-lg) 4px var(--r-lg)'
                            : 'var(--r-lg) var(--r-lg) var(--r-lg) 4px',
                        background: item.role === 'user' ? 'var(--bubble-user)' : 'var(--bubble-agent)',
                        border: '1px solid var(--border-dim)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        fontSize: '14px',
                        lineHeight: 1.6,
                        color: 'var(--text-primary)',
                        fontFamily: 'var(--font-ui)',
                        fontWeight: 300,
                    }}>
                        {item.content}
                    </div>
                </motion.div>
            ))}

            {/* Interim speech */}
            {interimText && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{
                        maxWidth: '78%', padding: '10px 14px',
                        borderRadius: 'var(--r-lg) var(--r-lg) 4px var(--r-lg)',
                        background: 'var(--bubble-user)',
                        border: '1px dashed var(--border-mid)',
                        color: 'var(--text-muted)', fontSize: '14px',
                        fontStyle: 'italic', fontFamily: 'var(--font-ui)',
                        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                    }}>
                        {interimText}
                        <span style={{ marginLeft: '2px', color: 'var(--gold)', animation: 'cursor-blink 1s step-end infinite' }}>|</span>
                    </div>
                </div>
            )}

            {/* Thinking */}
            {agentState === 'thinking' && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                    <div style={{
                        padding: '12px 18px',
                        borderRadius: 'var(--r-lg) var(--r-lg) var(--r-lg) 4px',
                        background: 'var(--bubble-agent)',
                        border: '1px solid var(--border-dim)',
                        backdropFilter: 'blur(16px)',
                        display: 'flex', gap: '6px', alignItems: 'center',
                    }}>
                        {[0, 0.18, 0.36].map((delay, i) => (
                            <span key={i} style={{
                                width: '5px', height: '5px', borderRadius: '50%',
                                background: 'var(--text-muted)', display: 'block',
                                animation: `shimmer-dots 1.4s ease ${delay}s infinite`,
                            }} />
                        ))}
                    </div>
                </div>
            )}
            <div ref={bottomRef} />
        </div>
    );
}

/* ── Inner Session ───────────────────────────────────────────────────────── */
function JocastaSession() {
    const { state: lkState, audioTrack, agentTranscriptions } = useVoiceAssistant();
    const agentState = (lkState as AgentState) ?? 'idle';

    const { messages, interimText, addItem, updateInterim, addUserTyped } = useTranscript();
    const { sendText } = useTextInput();

    const lastAgentMsg = useRef<string>('');
    const transcriptStartIndex = useRef<number>(0);
    const prevState = useRef<string>('');
    const [streamingAgentText, setStreamingAgent] = useState('');
    const [showTranscript, setShowTranscript] = useState(false);

    /* Auto-show transcript when messages arrive */
    useEffect(() => {
        if (messages.length > 0 || interimText) setShowTranscript(true);
    }, [messages.length, interimText]);

    /* Stream agent text */
    useEffect(() => {
        if (!agentTranscriptions?.length) return;
        const current = agentTranscriptions.slice(transcriptStartIndex.current);
        const text = current.map(t => t.text).join('').trim();
        if (text) setStreamingAgent(text);
    }, [agentTranscriptions]);

    /* State transitions */
    useEffect(() => {
        const wasNotSpeaking = prevState.current !== 'speaking';
        const wasSpeaking = prevState.current === 'speaking';
        const nowSpeaking = agentState === 'speaking';
        const nowNotSpeaking = agentState !== 'speaking';

        if (nowSpeaking && wasNotSpeaking) {
            transcriptStartIndex.current = agentTranscriptions?.length ?? 0;
            setStreamingAgent('');
        }
        if (wasSpeaking && nowNotSpeaking) {
            if (streamingAgentText.trim() && streamingAgentText.trim() !== lastAgentMsg.current) {
                lastAgentMsg.current = streamingAgentText.trim();
                addItem({
                    role: 'assistant', content: streamingAgentText.trim(),
                    timestamp: Date.now(), id: `agent-stream-${Date.now()}`,
                } as ConversationItem);
            }
            setStreamingAgent('');
        }
        prevState.current = agentState;
    }, [agentState, agentTranscriptions, streamingAgentText, addItem]);

    useAgentEvents({
        onTranscript: e => updateInterim(e.transcript, e.isFinal),
        onStateChange: _ => { },
        onItemAdded: item => {
            if (item.role === 'user') { addItem(item); }
            else if (item.content !== lastAgentMsg.current) {
                lastAgentMsg.current = item.content;
                setStreamingAgent('');
                addItem(item);
            }
        },
    });

    const handleSend = useCallback((text: string) => {
        addUserTyped(text);
        sendText(text);
        setShowTranscript(true);
    }, [addUserTyped, sendText]);

    const isConnected = lkState !== 'disconnected';

    const allMessages = streamingAgentText
        ? [...messages, {
            role: 'assistant' as const, content: streamingAgentText,
            timestamp: Date.now(), id: 'streaming-now',
        }]
        : messages;

    const hasContent = allMessages.length > 0 || !!interimText;

    return (
        <div style={{
            position: 'fixed', inset: 0,
            display: 'flex', flexDirection: 'column',
            background: 'var(--bg-void)',
            overflow: 'hidden',
        }}>
            {/* Atmospheric BG */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: `
          radial-gradient(ellipse 60% 50% at 50% 40%, rgba(200,146,42,0.04) 0%, transparent 70%),
          radial-gradient(ellipse 30% 40% at 10% 90%, rgba(93,93,180,0.03) 0%, transparent 60%)
        `,
            }} />

            {/* Grid */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.018,
                backgroundImage: `
          linear-gradient(var(--border-mid) 1px, transparent 1px),
          linear-gradient(90deg, var(--border-mid) 1px, transparent 1px)
        `,
                backgroundSize: '60px 60px',
            }} />

            <div className="noise-overlay" />

            {/* ── Header ──────────────────────────────────────────────────────── */}
            <header style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 24px',
                borderBottom: '1px solid var(--border-dim)',
                background: 'rgba(6,6,8,0.7)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                position: 'relative', zIndex: 20, flexShrink: 0,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* J avatar */}
                    <div style={{
                        width: '34px', height: '34px', borderRadius: '50%',
                        background: `radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '14px',
                        color: '#0c0a06',
                        boxShadow: agentState === 'speaking'
                            ? '0 0 0 3px var(--gold-glow), 0 0 20px var(--gold-glow)'
                            : '0 0 0 1px rgba(200,146,42,0.3)',
                        animation: agentState === 'speaking' ? 'ring-pulse 1.8s ease infinite' : 'none',
                        transition: 'box-shadow 0.4s ease',
                    }}>J</div>
                    <div>
                        <div style={{
                            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px',
                            letterSpacing: '-0.02em', color: 'var(--text-primary)',
                        }}>Jocasta</div>
                        <div style={{
                            fontFamily: 'var(--font-mono)', fontSize: '10px',
                            color: 'var(--text-muted)', letterSpacing: '0.08em',
                        }}>NEURAL VOICE ASSISTANT</div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {/* Transcript toggle */}
                    <button
                        onClick={() => setShowTranscript(v => !v)}
                        title={showTranscript ? 'Hide transcript' : 'Show transcript'}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '6px 12px',
                            borderRadius: '100px',
                            border: '1px solid var(--border-mid)',
                            background: showTranscript ? 'var(--gold-dim)' : 'var(--bg-glass)',
                            color: showTranscript ? 'var(--gold-bright)' : 'var(--text-muted)',
                            cursor: 'pointer', transition: 'all 0.2s',
                            fontFamily: 'var(--font-mono)', fontSize: '11px',
                            letterSpacing: '0.06em',
                        }}
                    >
                        <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                            <rect x="1" y="1" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                            <path d="M3 5h7M3 7.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        {allMessages.length > 0 ? `${allMessages.length}` : 'LOG'}
                    </button>
                </div>
            </header>

            {/* ── Main area ────────────────────────────────────────────────────── */}
            <div style={{
                flex: 1, position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', alignItems: 'center',
            }}>

                {/* Orb centred in main area */}
                <div style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative', zIndex: 5,
                    padding: showTranscript && hasContent ? '20px 24px 0' : '20px 24px',
                    transition: 'padding 0.4s ease',
                }}>
                    <motion.div
                        animate={{ scale: showTranscript && hasContent ? 0.82 : 1 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    >
                        <AgentOrb state={agentState} />
                    </motion.div>
                </div>

                {/* ── Transcript overlay — slides up ─────────────────────────────── */}
                <AnimatePresence>
                    {showTranscript && hasContent && (
                        <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: '45vh', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                            style={{
                                width: '100%', maxWidth: '640px', alignSelf: 'center',
                                overflow: 'hidden', flexShrink: 0,
                                borderTop: '1px solid var(--border-dim)',
                                background: 'rgba(6,6,8,0.65)',
                                backdropFilter: 'blur(20px)',
                                WebkitBackdropFilter: 'blur(20px)',
                                padding: '0 20px',
                                position: 'relative', zIndex: 10,
                            }}
                        >
                            <TranscriptPanel
                                messages={allMessages}
                                interimText={interimText}
                                agentState={agentState}
                                onClose={() => setShowTranscript(false)}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Controls ──────────────────────────────────────────────────────── */}
            <div style={{
                flexShrink: 0, position: 'relative', zIndex: 20,
                borderTop: '1px solid var(--border-dim)',
                background: 'rgba(6,6,8,0.85)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
            }}>
                {/* LiveKit control bar */}
                <div style={{
                    display: 'flex', justifyContent: 'center',
                    padding: '12px 20px 8px',
                    borderBottom: '1px solid var(--border-dim)',
                }}>
                    <VoiceAssistantControlBar />
                </div>

                {/* Text input */}
                <div style={{ maxWidth: '640px', margin: '0 auto', width: '100%' }}>
                    <TextInput onSend={handleSend} disabled={!isConnected} />
                </div>
            </div>

            <RoomAudioRenderer />
            <ClientToolHandler />
        </div>
    );
}

/* ── Root export ──────────────────────────────────────────────────────────── */
export function VoiceAgent() {
    const [conn, setConn] = useState<TokenResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startSession = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            setConn(await fetchToken());
        } catch {
            setError('Could not connect. Make sure the backend is running.');
        } finally {
            setLoading(false);
        }
    }, []);

    if (!conn) {
        /* Auto-start: just redirect to /chat which has the landing embedded.
           If needed, show inline connect UI for direct mount. */
        return (
            <div style={{
                position: 'fixed', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--bg-void)',
            }}>
                <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
                    {error && (
                        <p style={{
                            color: '#f87171', fontSize: '13px',
                            padding: '10px 16px', background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            borderRadius: 'var(--r-md)',
                            fontFamily: 'var(--font-mono)',
                        }}>{error}</p>
                    )}
                    <button
                        onClick={startSession}
                        disabled={loading}
                        style={{
                            padding: '13px 36px', borderRadius: '100px',
                            background: loading ? 'var(--bg-raised)' : 'var(--gold)',
                            color: loading ? 'var(--text-muted)' : '#0c0a06',
                            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
                            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '15px',
                            letterSpacing: '-0.01em',
                            boxShadow: loading ? 'none' : '0 8px 32px var(--gold-glow)',
                            transition: 'all 0.2s',
                        }}
                    >
                        {loading ? 'Connecting…' : 'Begin Session'}
                    </button>
                </div>
            </div>
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
            <JocastaSession />
        </LiveKitRoom>
    );
}