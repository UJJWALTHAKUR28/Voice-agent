'use client';

// components/VoiceAgent.tsx
// Jocasta — Full-screen voice interface
//
// Layout (Claude-like):
//   ┌─────────────────────────────────────┐
//   │  [Navbar — 56px]                    │
//   ├─────────────┬───────────────────────┤
//   │             │                       │
//   │    Sphere   │   Chat transcript     │
//   │   (always   │   (scrollable)        │
//   │   visible)  │                       │
//   │             │                       │
//   ├─────────────┴───────────────────────┤
//   │  [Text input + controls — 80px]     │
//   └─────────────────────────────────────┘
//
// On mobile: sphere on top, transcript below, stacked

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    LiveKitRoom,
    useVoiceAssistant,
    RoomAudioRenderer,
    VoiceAssistantControlBar,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { motion, AnimatePresence } from 'motion/react';

import { ClientToolHandler, playSound } from './ClientToolHandler';
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

/* ── Agent Sphere ─────────────────────────────────────────────────────────── */
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
        const DPR = window.devicePixelRatio || 1;
        const SIZE = 240;
        canvas.width = SIZE * DPR;
        canvas.height = SIZE * DPR;
        canvas.style.width = SIZE + 'px';
        canvas.style.height = SIZE + 'px';
        ctx.scale(DPR, DPR);
        const W = SIZE, H = SIZE;
        const cx = W / 2, cy = H / 2, R = 88;

        const N = 130;
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

            timeRef.current += isSpeaking ? 0.007 : isListening ? 0.005 : isThinking ? 0.003 : 0.0018;
            pulseT += isSpeaking ? 0.08 : 0.025;
            breatheT += 0.02;

            const breatheScale = 1 + Math.sin(breatheT) * (isSpeaking ? 0.06 : 0.018);
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
                const fov = 360;
                const sc = fov / (fov + fz * Rb);
                return { px: cx + rx * Rb * sc, py: cy + fy * Rb * sc, z: fz };
            }

            // Halo
            const haloA = isSpeaking ? 0.18 : isListening ? 0.08 : 0.03;
            const halo = ctx.createRadialGradient(cx, cy, Rb * 0.3, cx, cy, Rb * 1.6);
            halo.addColorStop(0, `rgba(200,146,42,${haloA})`);
            halo.addColorStop(1, 'rgba(200,146,42,0)');
            ctx.fillStyle = halo;
            ctx.fillRect(0, 0, W, H);

            // Edges
            for (const [a, b] of edges) {
                const pA = project(nodes[a].x, nodes[a].y, nodes[a].z);
                const pB = project(nodes[b].x, nodes[b].y, nodes[b].z);
                const vis = ((pA.z + pB.z) / 2 + 1) / 2;
                const baseA = isSpeaking ? 0.6 : isListening ? 0.45 : 0.22;
                const alpha = vis * baseA;
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

            // Nodes
            for (let i = 0; i < N; i++) {
                const p = project(nodes[i].x, nodes[i].y, nodes[i].z);
                const vis = (p.z + 1) / 2;
                const r = vis * (isSpeaking ? 2.2 : 1.7);
                const alpha = vis * (isSpeaking ? 0.95 : isListening ? 0.75 : 0.45);
                ctx.beginPath();
                ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(232,172,68,${alpha})`;
                ctx.fill();
                if ((isSpeaking || isListening) && vis > 0.8) {
                    ctx.beginPath();
                    ctx.arc(p.px, p.py, r * 3, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(200,146,42,${alpha * 0.09})`;
                    ctx.fill();
                }
            }

            // Pulse rings when speaking
            if (isSpeaking) {
                for (let ring = 0; ring < 4; ring++) {
                    const phase = (pulseT * 0.35 + ring * 0.65) % 1;
                    const rr = Rb * (0.85 + phase * 0.8);
                    const al = (1 - phase) * 0.2;
                    ctx.beginPath();
                    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
                    ctx.strokeStyle = `rgba(200,146,42,${al})`;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }
            }

            // Thinking: dashed arc
            if (isThinking) {
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(timeRef.current * 6);
                ctx.beginPath();
                ctx.arc(0, 0, Rb * 1.14, 0, Math.PI * 1.4);
                ctx.strokeStyle = 'rgba(157,123,234,0.5)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 7]);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }

            // Listening: pulsing ring
            if (isListening) {
                ctx.beginPath();
                ctx.arc(cx, cy, Rb * 1.1, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(45,212,160,${0.2 + Math.sin(pulseT * 3) * 0.08})`;
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
        idle: '#4a4a5c',
        listening: '#2dd4a0',
        thinking: '#9d7bea',
        speaking: '#5ba4f5',
    };
    const stateLabels: Record<AgentState, string> = {
        initializing: 'INIT',
        idle: 'READY',
        listening: 'LISTENING',
        thinking: 'PROCESSING',
        speaking: 'SPEAKING',
    };

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
        }}>
            <canvas
                ref={canvasRef}
                style={{
                    display: 'block',
                    filter: state === 'speaking'
                        ? 'drop-shadow(0 0 28px rgba(200,146,42,0.45))'
                        : state === 'listening'
                            ? 'drop-shadow(0 0 16px rgba(45,212,160,0.3))'
                            : 'drop-shadow(0 0 12px rgba(200,146,42,0.15))',
                    transition: 'filter 0.6s ease',
                }}
            />
            {/* Status pill */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                padding: '5px 14px',
                borderRadius: '100px',
                border: `1px solid ${stateColors[state]}30`,
                background: `${stateColors[state]}0f`,
                backdropFilter: 'blur(12px)',
                transition: 'all 0.4s ease',
            }}>
                <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: stateColors[state],
                    boxShadow: `0 0 8px ${stateColors[state]}aa`,
                    animation: (state === 'speaking' || state === 'listening') ? 'pulse-soft 1.8s ease infinite' : 'none',
                    flexShrink: 0,
                }} />
                <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    color: stateColors[state],
                    letterSpacing: '0.1em',
                }}>
                    {stateLabels[state]}
                </span>
            </div>
        </div>
    );
}

/* ── Message Bubble ──────────────────────────────────────────────────────── */
function MessageBubble({ item }: { item: ConversationItem }) {
    const isUser = item.role === 'user';
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{
                display: 'flex',
                justifyContent: isUser ? 'flex-end' : 'flex-start',
                marginBottom: '2px',
            }}
        >
            {/* Agent avatar dot */}
            {!isUser && (
                <div style={{
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: '10px',
                    color: '#0c0a06',
                    flexShrink: 0,
                    marginRight: '8px',
                    marginTop: '2px',
                    alignSelf: 'flex-end',
                }}>
                    J
                </div>
            )}
            <div style={{
                maxWidth: '72%',
                padding: '10px 14px',
                borderRadius: isUser
                    ? 'var(--r-lg) var(--r-lg) 4px var(--r-lg)'
                    : 'var(--r-lg) var(--r-lg) var(--r-lg) 4px',
                background: isUser ? 'var(--bubble-user)' : 'var(--bubble-agent)',
                border: '1px solid var(--border-dim)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                fontSize: '14px',
                lineHeight: 1.65,
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-ui)',
                fontWeight: 300,
                wordBreak: 'break-word',
            }}>
                {item.content}
            </div>
        </motion.div>
    );
}

/* ── Thinking Dots ────────────────────────────────────────────────────────── */
function ThinkingBubble() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
            <div style={{
                width: '22px', height: '22px', borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '10px', color: '#0c0a06',
                flexShrink: 0,
            }}>J</div>
            <div style={{
                padding: '12px 16px',
                borderRadius: 'var(--r-lg) var(--r-lg) var(--r-lg) 4px',
                background: 'var(--bubble-agent)',
                border: '1px solid var(--border-dim)',
                display: 'flex', gap: '5px', alignItems: 'center',
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
    );
}

/* ── Inner Session ────────────────────────────────────────────────────────── */
function JocastaSession() {
    const { state: lkState, agentTranscriptions } = useVoiceAssistant();
    const agentState = (lkState as AgentState) ?? 'idle';

    const { messages, interimText, addItem, updateInterim, addUserTyped } = useTranscript();
    const { sendText } = useTextInput();

    const [textValue, setTextValue] = useState('');
    const [streamingAgentText, setStreamingAgent] = useState('');
    const lastAgentMsg = useRef('');
    const transcriptStartIndex = useRef(0);
    const prevState = useRef('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const sessionStarted = useRef(false);

    // Play session_start sound once
    useEffect(() => {
        if (!sessionStarted.current && agentState !== 'initializing') {
            sessionStarted.current = true;
            setTimeout(() => playSound('session_start'), 400);
        }
    }, [agentState]);

    // Stream agent text
    useEffect(() => {
        if (!agentTranscriptions?.length) return;
        const current = agentTranscriptions.slice(transcriptStartIndex.current);
        const text = current.map(t => t.text).join('').trim();
        if (text) setStreamingAgent(text);
    }, [agentTranscriptions]);

    // State transitions
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

    // Auto-scroll
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, interimText, agentState, streamingAgentText]);

    const handleSend = useCallback(() => {
        const text = textValue.trim();
        if (!text) return;
        addUserTyped(text);
        sendText(text);
        setTextValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }, [textValue, addUserTyped, sendText]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const onInput = () => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };

    const isConnected = lkState !== 'disconnected';

    const allMessages: ConversationItem[] = streamingAgentText
        ? [...messages, {
            role: 'assistant' as const,
            content: streamingAgentText,
            timestamp: Date.now(),
            id: 'streaming-now',
        }]
        : messages;

    const hasMessages = allMessages.length > 0 || !!interimText;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            top: '56px', // below navbar
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-void)',
            overflow: 'hidden',
        }}>
            {/* Atmospheric backgrounds */}
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                background: `
                    radial-gradient(ellipse 50% 60% at 25% 40%, rgba(200,146,42,0.04) 0%, transparent 70%),
                    radial-gradient(ellipse 40% 50% at 75% 60%, rgba(93,164,245,0.03) 0%, transparent 60%)
                `,
            }} />
            <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.018,
                backgroundImage: `
                    linear-gradient(var(--border-mid) 1px, transparent 1px),
                    linear-gradient(90deg, var(--border-mid) 1px, transparent 1px)
                `,
                backgroundSize: '60px 60px',
            }} />
            <div className="noise-overlay" />

            {/* ── Body: sphere + transcript ─────────────────────────────────── */}
            <div style={{
                flex: 1,
                display: 'flex',
                overflow: 'hidden',
                minHeight: 0,
            }}>
                {/* Left panel: sphere (always visible) */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    width: hasMessages ? '280px' : '100%',
                    transition: 'width 0.5s cubic-bezier(0.16,1,0.3,1)',
                    padding: '24px 20px',
                    borderRight: hasMessages ? '1px solid var(--border-dim)' : 'none',
                    background: 'transparent',
                    position: 'relative',
                    zIndex: 2,
                }}>
                    <AgentOrb state={agentState} />

                    {/* Session info when no messages yet */}
                    {!hasMessages && (
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.4, duration: 0.5 }}
                            style={{
                                marginTop: '32px',
                                textAlign: 'center',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '10px',
                            }}
                        >
                            <p style={{
                                fontFamily: 'var(--font-display)',
                                fontSize: '20px',
                                fontWeight: 700,
                                color: 'var(--text-primary)',
                                letterSpacing: '-0.02em',
                            }}>
                                Jocasta is ready
                            </p>
                            <p style={{
                                fontFamily: 'var(--font-ui)',
                                fontSize: '13px',
                                fontWeight: 300,
                                color: 'var(--text-muted)',
                                maxWidth: '280px',
                                lineHeight: 1.6,
                            }}>
                                Speak or type below to begin. Ask about weather, news, calculations, or anything at all.
                            </p>
                            {/* Mic hint */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '7px 16px',
                                borderRadius: '100px',
                                border: '1px dashed var(--border-mid)',
                                color: 'var(--text-ghost)',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                letterSpacing: '0.06em',
                                marginTop: '4px',
                            }}>
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <rect x="4" y="1" width="4" height="6" rx="2" stroke="currentColor" strokeWidth="1.2" />
                                    <path d="M2 6a4 4 0 008 0M6 10v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                                </svg>
                                VOICE ACTIVE
                            </div>
                        </motion.div>
                    )}
                </div>

                {/* Right panel: chat transcript */}
                <AnimatePresence>
                    {hasMessages && (
                        <motion.div
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            style={{
                                flex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                                minWidth: 0,
                                position: 'relative',
                            }}
                        >
                            {/* Transcript header */}
                            <div style={{
                                flexShrink: 0,
                                padding: '12px 20px',
                                borderBottom: '1px solid var(--border-dim)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(6,6,8,0.4)',
                                backdropFilter: 'blur(16px)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                        <rect x="1" y="1" width="11" height="9" rx="1.5" stroke="var(--text-muted)" strokeWidth="1.1" />
                                        <path d="M3 5h7M3 7.5h5" stroke="var(--text-muted)" strokeWidth="1.1" strokeLinecap="round" />
                                    </svg>
                                    <span style={{
                                        fontFamily: 'var(--font-mono)',
                                        fontSize: '10px',
                                        color: 'var(--text-muted)',
                                        letterSpacing: '0.1em',
                                        textTransform: 'uppercase',
                                    }}>
                                        TRANSCRIPT — {allMessages.length} {allMessages.length === 1 ? 'MESSAGE' : 'MESSAGES'}
                                    </span>
                                </div>
                            </div>

                            {/* Messages */}
                            <div style={{
                                flex: 1,
                                overflowY: 'auto',
                                padding: '20px 24px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px',
                            }}>
                                {allMessages.map(item => (
                                    <MessageBubble key={item.id} item={item} />
                                ))}

                                {/* Interim speech */}
                                {interimText && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <div style={{
                                            maxWidth: '72%',
                                            padding: '10px 14px',
                                            borderRadius: 'var(--r-lg) var(--r-lg) 4px var(--r-lg)',
                                            background: 'var(--bubble-user)',
                                            border: '1px dashed var(--border-mid)',
                                            color: 'var(--text-muted)',
                                            fontSize: '14px',
                                            fontStyle: 'italic',
                                            fontFamily: 'var(--font-ui)',
                                        }}>
                                            {interimText}
                                            <span style={{
                                                marginLeft: '2px',
                                                color: 'var(--gold)',
                                                animation: 'cursor-blink 1s step-end infinite',
                                            }}>|</span>
                                        </div>
                                    </div>
                                )}

                                {agentState === 'thinking' && <ThinkingBubble />}

                                <div ref={bottomRef} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* ── Bottom controls ───────────────────────────────────────────── */}
            <div style={{
                flexShrink: 0,
                borderTop: '1px solid var(--border-dim)',
                background: 'rgba(6,6,8,0.9)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                position: 'relative',
                zIndex: 20,
            }}>
                {/* LiveKit control bar */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '10px 20px 0',
                }}>
                    <VoiceAssistantControlBar />
                </div>

                {/* Text input */}
                <div style={{
                    maxWidth: '720px',
                    margin: '0 auto',
                    width: '100%',
                    padding: '10px 20px 14px',
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: '10px',
                }}>
                    <textarea
                        ref={textareaRef}
                        value={textValue}
                        onChange={e => setTextValue(e.target.value)}
                        onKeyDown={onKeyDown}
                        onInput={onInput}
                        placeholder="Type a message…"
                        disabled={!isConnected}
                        rows={1}
                        style={{
                            flex: 1,
                            padding: '10px 14px',
                            borderRadius: '12px',
                            border: '1px solid var(--border-mid)',
                            background: 'var(--bg-raised)',
                            color: 'var(--text-primary)',
                            fontFamily: 'var(--font-ui)',
                            fontSize: '14px',
                            lineHeight: 1.55,
                            resize: 'none',
                            outline: 'none',
                            minHeight: '42px',
                            maxHeight: '120px',
                            overflowY: 'auto',
                            transition: 'border-color 0.2s',
                        }}
                        onFocus={e => {
                            e.target.style.borderColor = 'rgba(200,146,42,0.5)';
                            e.target.style.boxShadow = '0 0 0 2px rgba(200,146,42,0.08)';
                        }}
                        onBlur={e => {
                            e.target.style.borderColor = 'var(--border-mid)';
                            e.target.style.boxShadow = 'none';
                        }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!textValue.trim() || !isConnected}
                        title="Send (Enter)"
                        style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '12px',
                            background: textValue.trim() && isConnected ? 'var(--gold)' : 'var(--bg-glass)',
                            border: `1px solid ${textValue.trim() && isConnected ? 'rgba(200,146,42,0.4)' : 'var(--border-mid)'}`,
                            color: textValue.trim() && isConnected ? '#0c0a06' : 'var(--text-muted)',
                            cursor: textValue.trim() && isConnected ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            fontSize: '18px',
                            transition: 'all 0.2s',
                            boxShadow: textValue.trim() && isConnected ? '0 4px 16px rgba(200,146,42,0.25)' : 'none',
                        }}
                    >
                        ↑
                    </button>
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
        setLoading(true);
        setError(null);
        try {
            setConn(await fetchToken());
        } catch {
            setError('Could not connect. Make sure the backend is running.');
        } finally {
            setLoading(false);
        }
    }, []);

    if (!conn) {
        return (
            <div style={{
                position: 'fixed',
                inset: 0,
                top: '56px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-void)',
            }}>
                {/* Atmosphere */}
                <div style={{
                    position: 'absolute', inset: 0, pointerEvents: 'none',
                    background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(200,146,42,0.04) 0%, transparent 70%)',
                }} />

                <div style={{
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '28px',
                    position: 'relative',
                    zIndex: 1,
                }}>
                    {/* Animated orb preview */}
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        background: 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 800,
                        fontSize: '28px',
                        color: '#0c0a06',
                        boxShadow: '0 0 0 1px rgba(200,146,42,0.3), 0 0 40px rgba(200,146,42,0.2)',
                        animation: 'orb-breathe 3s ease infinite',
                    }}>
                        J
                    </div>

                    <div>
                        <h2 style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: '22px',
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            letterSpacing: '-0.02em',
                            marginBottom: '8px',
                        }}>
                            Begin Voice Session
                        </h2>
                        <p style={{
                            fontFamily: 'var(--font-ui)',
                            fontSize: '13px',
                            fontWeight: 300,
                            color: 'var(--text-secondary)',
                        }}>
                            Microphone access required
                        </p>
                    </div>

                    {error && (
                        <div style={{
                            padding: '10px 18px',
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            borderRadius: '10px',
                            color: '#f87171',
                            fontSize: '13px',
                            fontFamily: 'var(--font-mono)',
                            maxWidth: '320px',
                            textAlign: 'left',
                        }}>
                            {error}
                        </div>
                    )}

                    <button
                        onClick={startSession}
                        disabled={loading}
                        style={{
                            padding: '13px 40px',
                            borderRadius: '100px',
                            background: loading ? 'var(--bg-raised)' : 'var(--gold)',
                            color: loading ? 'var(--text-muted)' : '#0c0a06',
                            border: 'none',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            fontFamily: 'var(--font-display)',
                            fontWeight: 700,
                            fontSize: '15px',
                            letterSpacing: '-0.01em',
                            boxShadow: loading ? 'none' : '0 8px 32px rgba(200,146,42,0.3)',
                            transition: 'all 0.2s',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                        }}
                    >
                        {loading ? (
                            <>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'rotate-slow 1s linear infinite' }}>
                                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" />
                                </svg>
                                Connecting…
                            </>
                        ) : (
                            <>
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                    <rect x="6" y="2" width="4" height="8" rx="2" fill="currentColor" />
                                    <path d="M3 8a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                    <path d="M8 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                </svg>
                                Begin Session
                            </>
                        )}
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