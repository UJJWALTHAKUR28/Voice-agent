'use client';

// components/VoiceAgent.tsx — ENHANCED
// Pre-session: rich "Begin Session" screen with animated sphere, feature pills, tips
// In-session: unchanged sage/gold aesthetic, glass-morphism chat

import { useState, useCallback, useEffect, useRef } from 'react';
import {
    LiveKitRoom,
    useVoiceAssistant,
    RoomAudioRenderer,
    VoiceAssistantControlBar,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { motion, AnimatePresence } from 'motion/react';

import { ClientToolHandler, CardOverlay, playSound } from './ClientToolHandler';
import type { WeatherData, CalcData } from './ClientToolHandler';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useTranscript } from '../hooks/useTranscript';
import { useTextInput } from '../hooks/useTextInput';
import type { AgentState, ConversationItem } from '@/hooks/useAgentEvents';

// ── Theme detection ───────────────────────────────────────────────────────────

function isLightTheme(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        document.documentElement.hasAttribute('data-theme') ||
        document.documentElement.classList.contains('light')
    );
}

interface TokenResponse { token: string; url: string; room: string; }

async function fetchToken(): Promise<TokenResponse> {
    const res = await fetch('/api/token');
    if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
    return res.json();
}

// ── Mini animated sphere for pre-session card ─────────────────────────────────

function MiniSphere({ size = 120, active = true }: { size?: number; active?: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const timeRef = useRef(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const DPR = window.devicePixelRatio || 1;
        canvas.width = size * DPR;
        canvas.height = size * DPR;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        const ctx = canvas.getContext('2d')!;
        ctx.scale(DPR, DPR);
        const W = size, H = size, cx = W / 2, cy = H / 2, R = size * 0.35;

        const N = 80;
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
                const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z;
                if (dx * dx + dy * dy + dz * dz < 0.18) edges.push([i, j]);
            }
        }

        function draw() {
            const light = isLightTheme();
            const nodeC = light ? 'rgba(46,125,82,' : 'rgba(232,172,68,';
            const edgeC = light ? 'rgba(26,92,58,' : 'rgba(200,146,42,';
            const haloC = light ? 'rgba(26,92,58,' : 'rgba(200,146,42,';

            timeRef.current += 0.004;
            const angle = timeRef.current, tiltX = 0.3;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);

            ctx.clearRect(0, 0, W, H);

            function project(nx: number, ny: number, nz: number) {
                const rx = nx * cosA + nz * sinA, ry = ny, rz = -nx * sinA + nz * cosA;
                const fy = ry * cosX - rz * sinX, fz = ry * sinX + rz * cosX;
                const fov = 300, sc = fov / (fov + fz * R);
                return { px: cx + rx * R * sc, py: cy + fy * R * sc, z: fz };
            }

            const halo = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.8);
            halo.addColorStop(0, `${haloC}0.12)`);
            halo.addColorStop(1, `${haloC}0)`);
            ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);

            for (const [a, b] of edges) {
                const pA = project(nodes[a].x, nodes[a].y, nodes[a].z);
                const pB = project(nodes[b].x, nodes[b].y, nodes[b].z);
                const vis = ((pA.z + pB.z) / 2 + 1) / 2;
                ctx.beginPath(); ctx.moveTo(pA.px, pA.py); ctx.lineTo(pB.px, pB.py);
                ctx.strokeStyle = `${edgeC}${vis * 0.45})`; ctx.lineWidth = vis * 0.6; ctx.stroke();
            }
            for (let i = 0; i < N; i++) {
                const p = project(nodes[i].x, nodes[i].y, nodes[i].z);
                const vis = (p.z + 1) / 2;
                ctx.beginPath(); ctx.arc(p.px, p.py, vis * 1.8, 0, Math.PI * 2);
                ctx.fillStyle = `${nodeC}${vis * 0.8})`; ctx.fill();
            }
            animRef.current = requestAnimationFrame(draw);
        }
        animRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animRef.current);
    }, [size]);

    return <canvas ref={canvasRef} style={{ display: 'block' }} />;
}

// ── Capability pill ───────────────────────────────────────────────────────────

function CapPill({ icon, label, light }: { icon: string; label: string; light: boolean }) {
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            padding: '6px 13px', borderRadius: '100px',
            background: light ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.05)',
            border: light ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
            boxShadow: light ? '0 1px 6px rgba(15,40,20,0.06), inset 0 1px 0 rgba(255,255,255,0.90)' : 'none',
            fontFamily: 'var(--font-mono)', fontSize: '11px',
            color: light ? '#2d6a4f' : 'var(--text-secondary)',
            letterSpacing: '0.04em',
        }}>
            <span style={{ fontSize: '13px' }}>{icon}</span>
            {label}
        </div>
    );
}

// ── Tip row ───────────────────────────────────────────────────────────────────

function TipRow({ tip, light }: { tip: string; light: boolean }) {
    return (
        <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 14px',
            borderRadius: '10px',
            background: light ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.03)',
            border: light ? '1px solid rgba(255,255,255,0.80)' : '1px solid rgba(255,255,255,0.06)',
            backdropFilter: 'blur(12px)',
        }}>
            <span style={{
                width: '5px', height: '5px', borderRadius: '50%', marginTop: '6px',
                background: light ? '#2d6a4f' : 'var(--gold)', flexShrink: 0,
                boxShadow: light ? '0 0 6px rgba(45,106,79,0.4)' : '0 0 6px var(--gold-glow)',
            }} />
            <span style={{
                fontFamily: 'var(--font-ui)', fontSize: '13px', lineHeight: 1.55,
                color: light ? '#354a36' : 'var(--text-secondary)', fontWeight: 300,
            }}>{tip}</span>
        </div>
    );
}

// ── Pre-session Screen ────────────────────────────────────────────────────────
// Rich landing before the user starts a session

function PreSessionScreen({
    onStart,
    loading,
    error,
}: {
    onStart: () => void;
    loading: boolean;
    error: string | null;
}) {
    const [light, setLight] = useState(false);
    useEffect(() => {
        setLight(isLightTheme());
        const obs = new MutationObserver(() => setLight(isLightTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => obs.disconnect();
    }, []);

    const caps = [
        { icon: '🎙', label: 'Voice + Text' },
        { icon: '🌤', label: 'Live Weather' },
        { icon: '📰', label: 'Headlines' },
        { icon: '🧮', label: 'Calculator' },
        { icon: '🔒', label: 'Encrypted' },
    ];

    const tips = [
        'Ask "what\'s the weather in Tokyo?" to get a live weather card.',
        'Say "calculate 15% of 340" for instant math results.',
        'Type or speak — both work. Switch anytime.',
    ];

    const accentColor = light ? '#2d6a4f' : 'var(--gold)';
    const accentGlow = light ? 'rgba(45,106,79,0.25)' : 'var(--gold-glow)';
    const btnBg = loading
        ? light ? 'rgba(45,106,79,0.12)' : 'var(--bg-raised)'
        : light ? 'rgba(26,92,58,0.82)' : 'var(--gold)';
    const btnColor = loading
        ? 'var(--text-muted)'
        : light ? '#fff' : '#0c0a06';

    return (
        <div style={{
            position: 'fixed', inset: 0, top: '56px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-void)', overflow: 'auto',
            padding: '32px 20px',
            transition: 'background 0.35s ease',
        }}>
            {/* Background gradient */}
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none',
                background: light
                    ? 'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(26,92,58,0.06) 0%, transparent 65%)'
                    : 'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(200,146,42,0.05) 0%, transparent 65%)',
            }} />
            <div style={{
                position: 'fixed', inset: 0, pointerEvents: 'none', opacity: 0.015,
                backgroundImage: light
                    ? 'linear-gradient(rgba(26,92,58,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(26,92,58,0.25) 1px, transparent 1px)'
                    : 'linear-gradient(var(--border-dim) 1px, transparent 1px), linear-gradient(90deg, var(--border-dim) 1px, transparent 1px)',
                backgroundSize: '48px 48px',
            }} />

            <motion.div
                initial={{ opacity: 0, y: 28 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '880px' }}
            >
                {/* ── Main card ── */}
                <div style={{
                    borderRadius: '28px',
                    background: light
                        ? 'linear-gradient(145deg, rgba(248,251,248,0.92) 0%, rgba(238,244,238,0.88) 100%)'
                        : 'linear-gradient(145deg, rgba(22,22,29,0.95) 0%, rgba(16,16,21,0.90) 100%)',
                    border: light ? '1px solid rgba(255,255,255,0.85)' : '1px solid var(--border-mid)',
                    backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
                    boxShadow: light
                        ? '0 1px 0 rgba(255,255,255,1) inset, 0 32px 80px rgba(15,40,20,0.12), 0 8px 24px rgba(15,40,20,0.06)'
                        : '0 1px 0 rgba(255,255,255,0.06) inset, 0 32px 80px rgba(0,0,0,0.45)',
                    overflow: 'hidden',
                }}>
                    {/* Top accent bar */}
                    <div style={{
                        height: '3px',
                        background: light
                            ? 'linear-gradient(90deg, transparent 0%, rgba(26,92,58,0.0) 5%, rgba(26,92,58,0.6) 30%, rgba(82,168,113,0.8) 50%, rgba(26,92,58,0.6) 70%, rgba(26,92,58,0.0) 95%, transparent 100%)'
                            : 'linear-gradient(90deg, transparent 0%, rgba(200,146,42,0.0) 5%, rgba(200,146,42,0.6) 30%, rgba(232,172,68,0.8) 50%, rgba(200,146,42,0.6) 70%, rgba(200,146,42,0.0) 95%, transparent 100%)',
                    }} />

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', minHeight: '500px' }}>
                        {/* ── Left: sphere + identity ── */}
                        <div style={{
                            padding: '48px 40px',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            borderRight: light ? '1px solid rgba(26,92,58,0.08)' : '1px solid var(--border-dim)',
                            position: 'relative',
                            background: light
                                ? 'linear-gradient(160deg, rgba(255,255,255,0.40) 0%, rgba(240,247,240,0.20) 100%)'
                                : 'linear-gradient(160deg, rgba(255,255,255,0.02) 0%, transparent 100%)',
                        }}>
                            {/* Atmosphere behind sphere */}
                            <div style={{
                                position: 'absolute',
                                width: '260px', height: '260px', borderRadius: '50%',
                                background: light
                                    ? 'radial-gradient(circle, rgba(26,92,58,0.08) 0%, transparent 70%)'
                                    : 'radial-gradient(circle, rgba(200,146,42,0.10) 0%, transparent 70%)',
                                filter: 'blur(30px)', pointerEvents: 'none',
                                animation: 'orb-breathe 5s ease-in-out infinite',
                            }} />

                            <motion.div
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                                style={{ position: 'relative', zIndex: 1 }}
                            >
                                <MiniSphere size={160} />
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.3, duration: 0.5 }}
                                style={{ marginTop: '24px', textAlign: 'center', position: 'relative', zIndex: 1 }}
                            >
                                <div style={{
                                    fontFamily: 'var(--font-display)', fontSize: '28px',
                                    fontWeight: 800, letterSpacing: '-0.03em',
                                    color: 'var(--text-primary)', marginBottom: '6px',
                                }}>Jocasta</div>
                                <div style={{
                                    fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 300,
                                    color: 'var(--text-secondary)', lineHeight: 1.55,
                                    marginBottom: '16px',
                                }}>
                                    Neural voice intelligence.<br />Five layers. Zero downtime.
                                </div>

                                {/* Status badge */}
                                <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                                    padding: '6px 14px', borderRadius: '100px',
                                    background: light ? 'rgba(255,255,255,0.60)' : 'rgba(45,212,160,0.08)',
                                    border: light ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(45,212,160,0.20)',
                                    backdropFilter: 'blur(12px)',
                                    boxShadow: light ? '0 2px 8px rgba(15,40,20,0.06), inset 0 1px 0 rgba(255,255,255,0.90)' : 'none',
                                }}>
                                    <span style={{
                                        width: '6px', height: '6px', borderRadius: '50%',
                                        background: 'var(--c-listen)', flexShrink: 0,
                                        boxShadow: '0 0 8px rgba(45,212,160,0.7)',
                                        animation: 'pulse-soft 2s ease infinite',
                                    }} />
                                    <span style={{
                                        fontFamily: 'var(--font-mono)', fontSize: '10px',
                                        color: 'var(--c-listen)', letterSpacing: '0.10em',
                                    }}>AGENT ONLINE</span>
                                </div>
                            </motion.div>
                        </div>

                        {/* ── Right: info + action ── */}
                        <div style={{ padding: '48px 40px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '24px' }}>
                            {/* Caps */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.15, duration: 0.5 }}
                            >
                                <div style={{
                                    fontFamily: 'var(--font-mono)', fontSize: '9px',
                                    color: 'var(--text-muted)', letterSpacing: '0.14em',
                                    textTransform: 'uppercase', marginBottom: '10px',
                                }}>CAPABILITIES</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
                                    {caps.map(c => (
                                        <CapPill key={c.label} icon={c.icon} label={c.label} light={light} />
                                    ))}
                                </div>
                            </motion.div>

                            {/* Tips */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.25, duration: 0.5 }}
                            >
                                <div style={{
                                    fontFamily: 'var(--font-mono)', fontSize: '9px',
                                    color: 'var(--text-muted)', letterSpacing: '0.14em',
                                    textTransform: 'uppercase', marginBottom: '10px',
                                }}>TRY ASKING</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {tips.map((tip, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: 12 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: 0.3 + i * 0.07, duration: 0.4 }}
                                        >
                                            <TipRow tip={tip} light={light} />
                                        </motion.div>
                                    ))}
                                </div>
                            </motion.div>

                            {/* Error */}
                            <AnimatePresence>
                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                                        style={{
                                            padding: '10px 16px',
                                            background: light ? 'rgba(180,40,40,0.06)' : 'rgba(239,68,68,0.08)',
                                            border: light ? '1px solid rgba(180,40,40,0.20)' : '1px solid rgba(239,68,68,0.25)',
                                            borderRadius: '10px',
                                            color: light ? '#b83232' : '#f87171',
                                            fontSize: '12px', fontFamily: 'var(--font-mono)',
                                        }}
                                    >{error}</motion.div>
                                )}
                            </AnimatePresence>

                            {/* CTA */}
                            <motion.div
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.55, duration: 0.5 }}
                                style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
                            >
                                <button
                                    onClick={onStart}
                                    disabled={loading}
                                    style={{
                                        padding: '14px 32px', borderRadius: '14px',
                                        background: btnBg,
                                        color: btnColor,
                                        border: loading
                                            ? light ? '1px solid rgba(45,106,79,0.12)' : '1px solid var(--border-mid)'
                                            : light ? '1px solid rgba(26,92,58,0.50)' : '1px solid rgba(232,172,68,0.4)',
                                        cursor: loading ? 'not-allowed' : 'pointer',
                                        fontFamily: 'var(--font-display)', fontWeight: 700,
                                        fontSize: '15px', letterSpacing: '-0.01em',
                                        width: '100%',
                                        boxShadow: loading ? 'none'
                                            : light
                                                ? '0 1px 0 rgba(255,255,255,0.25) inset, 0 10px 36px rgba(26,92,58,0.28)'
                                                : '0 1px 0 rgba(255,255,255,0.15) inset, 0 8px 32px rgba(200,146,42,0.35)',
                                        transition: 'all 0.25s ease',
                                        backdropFilter: 'blur(12px)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                                    }}
                                    onMouseEnter={e => {
                                        if (loading) return;
                                        const el = e.currentTarget as HTMLElement;
                                        el.style.transform = 'translateY(-2px)';
                                        el.style.boxShadow = light
                                            ? '0 1px 0 rgba(255,255,255,0.25) inset, 0 16px 48px rgba(26,92,58,0.36)'
                                            : '0 1px 0 rgba(255,255,255,0.2) inset, 0 14px 44px rgba(200,146,42,0.45)';
                                    }}
                                    onMouseLeave={e => {
                                        const el = e.currentTarget as HTMLElement;
                                        el.style.transform = 'translateY(0)';
                                        el.style.boxShadow = loading ? 'none'
                                            : light
                                                ? '0 1px 0 rgba(255,255,255,0.25) inset, 0 10px 36px rgba(26,92,58,0.28)'
                                                : '0 1px 0 rgba(255,255,255,0.15) inset, 0 8px 32px rgba(200,146,42,0.35)';
                                    }}
                                >
                                    {loading ? (
                                        <>
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 'rotate-slow 1s linear infinite' }}>
                                                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" />
                                            </svg>
                                            Connecting to agent…
                                        </>
                                    ) : (
                                        <>
                                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                                <rect x="6" y="2" width="4" height="8" rx="2" fill="currentColor" />
                                                <path d="M3 8a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                                <path d="M8 13v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                            </svg>
                                            Begin Voice Session
                                        </>
                                    )}
                                </button>

                                <p style={{
                                    textAlign: 'center',
                                    fontFamily: 'var(--font-mono)', fontSize: '10px',
                                    color: 'var(--text-muted)', letterSpacing: '0.06em',
                                }}>
                                    MICROPHONE REQUIRED · CHROME / FIREFOX / SAFARI 17+
                                </p>
                            </motion.div>
                        </div>
                    </div>
                </div>

                {/* ── Pipeline strip below card ── */}

            </motion.div>
        </div>
    );
}

// ── AgentOrb — adapts colours per theme AND per state ────────────────────────

function AgentOrb({ state }: { state: AgentState }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animRef = useRef<number>(0);
    const timeRef = useRef(0);
    const stateRef = useRef(state);
    stateRef.current = state;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const DPR = window.devicePixelRatio || 1;
        const SIZE = 240;
        canvas.width = SIZE * DPR;
        canvas.height = SIZE * DPR;
        canvas.style.width = SIZE + 'px';
        canvas.style.height = SIZE + 'px';
        const ctx = canvas.getContext('2d')!;
        ctx.scale(DPR, DPR);
        const W = SIZE, H = SIZE, cx = W / 2, cy = H / 2, R = 82;

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
                const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, dz = nodes[i].z - nodes[j].z;
                if (dx * dx + dy * dy + dz * dz < 0.17) edges.push([i, j]);
            }
        }

        const rings = [
            { rx: 1.2, ry: 0.0, rm: 1.22, speed: 0.55, phase: 0.0 },
            { rx: 0.5, ry: 0.9, rm: 1.40, speed: -0.38, phase: 1.1 },
            { rx: 0.2, ry: 0.4, rm: 1.58, speed: 0.22, phase: 2.2 },
        ];
        const blips = rings.map((_, ri) => ({ t: ri * 0.33, speed: 0.9 + ri * 0.35 }));
        let pulseT = 0, breatheT = 0;

        function getColors() {
            const s = stateRef.current;
            const light = isLightTheme();
            if (light) {
                const nodeC = s === 'listening' ? 'rgba(45,106,79,' : s === 'thinking' ? 'rgba(188,108,37,' : s === 'speaking' ? 'rgba(64,145,108,' : 'rgba(45,106,79,';
                return { node: nodeC, edge: 'rgba(45,106,79,', ring: 'rgba(45,106,79,', halo: 'rgba(45,106,79,', blip: s === 'thinking' ? 'rgba(188,108,37,' : s === 'listening' ? 'rgba(116,198,157,' : 'rgba(64,145,108,', listenRing: 'rgba(64,145,108,', thinkArc: 'rgba(188,108,37,' };
            }
            const nodeC = s === 'listening' ? 'rgba(45,212,160,' : s === 'thinking' ? 'rgba(200,160,80,' : s === 'speaking' ? 'rgba(232,172,68,' : 'rgba(200,146,42,';
            return { node: nodeC, edge: 'rgba(200,146,42,', ring: 'rgba(200,146,42,', halo: 'rgba(200,146,42,', blip: s === 'thinking' ? 'rgba(200,160,80,' : s === 'listening' ? 'rgba(45,212,160,' : 'rgba(232,172,68,', listenRing: 'rgba(45,212,160,', thinkArc: 'rgba(220,170,60,' };
        }

        function draw() {
            const s = stateRef.current;
            const isSpeaking = s === 'speaking', isListening = s === 'listening', isThinking = s === 'thinking';
            const colors = getColors();
            timeRef.current += isSpeaking ? 0.0075 : isListening ? 0.0055 : isThinking ? 0.003 : 0.002;
            pulseT += isSpeaking ? 0.09 : 0.028; breatheT += 0.018;
            const breatheScale = 1 + Math.sin(breatheT) * (isSpeaking ? 0.065 : 0.02);
            const angle = timeRef.current, tiltX = 0.3;
            const cosA = Math.cos(angle), sinA = Math.sin(angle);
            const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
            const Rb = R * breatheScale;
            ctx.clearRect(0, 0, W, H);

            function project(nx: number, ny: number, nz: number) {
                const rx = nx * cosA + nz * sinA, ry = ny, rz = -nx * sinA + nz * cosA;
                const fy = ry * cosX - rz * sinX, fz = ry * sinX + rz * cosX;
                const fov = 360, sc = fov / (fov + fz * Rb);
                return { px: cx + rx * Rb * sc, py: cy + fy * Rb * sc, z: fz };
            }

            const haloA = isSpeaking ? 0.28 : isListening ? 0.14 : isLightTheme() ? 0.10 : 0.04;
            const halo = ctx.createRadialGradient(cx, cy, Rb * 0.2, cx, cy, Rb * 1.8);
            halo.addColorStop(0, `${colors.halo}${haloA})`);
            halo.addColorStop(0.5, `${colors.halo}${haloA * 0.4})`);
            halo.addColorStop(1, `${colors.halo}0)`);
            ctx.fillStyle = halo; ctx.fillRect(0, 0, W, H);

            const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rb * 0.55);
            core.addColorStop(0, `${colors.halo}${isSpeaking ? 0.16 : isLightTheme() ? 0.08 : 0.05})`);
            core.addColorStop(1, `${colors.halo}0)`);
            ctx.beginPath(); ctx.arc(cx, cy, Rb * 0.55, 0, Math.PI * 2);
            ctx.fillStyle = core; ctx.fill();

            for (const [a, b] of edges) {
                const pA = project(nodes[a].x, nodes[a].y, nodes[a].z);
                const pB = project(nodes[b].x, nodes[b].y, nodes[b].z);
                const vis = ((pA.z + pB.z) / 2 + 1) / 2;
                const baseA = isSpeaking ? 0.65 : isListening ? 0.50 : isLightTheme() ? 0.45 : 0.25;
                const grd = ctx.createLinearGradient(pA.px, pA.py, pB.px, pB.py);
                grd.addColorStop(0, `${colors.edge}${vis * baseA * 0.6})`);
                grd.addColorStop(0.5, `${colors.edge}${vis * baseA})`);
                grd.addColorStop(1, `${colors.edge}${vis * baseA * 0.6})`);
                ctx.beginPath(); ctx.moveTo(pA.px, pA.py); ctx.lineTo(pB.px, pB.py);
                ctx.strokeStyle = grd; ctx.lineWidth = vis * (isSpeaking ? 0.9 : 0.55); ctx.stroke();
            }
            for (let i = 0; i < N; i++) {
                const p = project(nodes[i].x, nodes[i].y, nodes[i].z);
                const vis = (p.z + 1) / 2;
                const r = vis * (isSpeaking ? 2.4 : 1.8);
                const alpha = vis * (isSpeaking ? 0.95 : isListening ? 0.80 : isLightTheme() ? 0.70 : 0.50);
                ctx.beginPath(); ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
                ctx.fillStyle = `${colors.node}${alpha})`; ctx.fill();
                if ((isSpeaking || isListening) && vis > 0.78) {
                    ctx.beginPath(); ctx.arc(p.px, p.py, r * 3.2, 0, Math.PI * 2);
                    ctx.fillStyle = `${colors.node}${alpha * 0.09})`; ctx.fill();
                }
            }
            rings.forEach((ring, ri) => {
                const ringR = Rb * ring.rm;
                const ringAlpha = isSpeaking ? 0.8 : isListening ? 0.65 : isThinking ? 0.55 : isLightTheme() ? 0.55 : 0.40;
                ctx.save(); ctx.translate(cx, cy); ctx.beginPath();
                let first = true;
                for (let step = 0; step <= 100; step++) {
                    const t = (step / 100) * Math.PI * 2;
                    const modT = ((t / (Math.PI * 2)) + 1) % 1;
                    if (modT < 0.07 || (modT > 0.45 && modT < 0.47)) continue;
                    const rx3 = Math.cos(t) * ringR, ry3 = Math.sin(t) * ringR * Math.cos(ring.rx), rz3 = Math.sin(t) * ringR * Math.sin(ring.rx);
                    const rxx = rx3 * Math.cos(ring.ry + angle * ring.speed * 0.5) + rz3 * Math.sin(ring.ry + angle * ring.speed * 0.5);
                    const ryy = ry3; const fov = 360, sc = fov / (fov + rz3 * 0.35);
                    const px = rxx * sc, py = ryy * sc;
                    if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
                }
                ctx.strokeStyle = `${colors.ring}${ringAlpha})`; ctx.lineWidth = isSpeaking ? 1.3 : 0.8; ctx.stroke(); ctx.restore();
                blips[ri].t = (blips[ri].t + blips[ri].speed * 0.005) % 1;
                const bt = blips[ri].t * Math.PI * 2;
                const bx3 = Math.cos(bt) * ringR, by3 = Math.sin(bt) * ringR * Math.cos(ring.rx), bz3 = Math.sin(bt) * ringR * Math.sin(ring.rx);
                const bxx = bx3 * Math.cos(ring.ry + angle * ring.speed * 0.5) + bz3 * Math.sin(ring.ry + angle * ring.speed * 0.5);
                const byy = by3; const bfov = 360, bsc = bfov / (bfov + bz3 * 0.35);
                ctx.beginPath(); ctx.arc(cx + bxx * bsc, cy + byy * bsc, isSpeaking ? 3.2 : 2, 0, Math.PI * 2);
                ctx.fillStyle = `${colors.blip}${isSpeaking ? 1 : 0.7})`; ctx.fill();
                if (isSpeaking || isListening) {
                    ctx.beginPath(); ctx.arc(cx + bxx * bsc, cy + byy * bsc, 7, 0, Math.PI * 2);
                    ctx.fillStyle = `${colors.blip}0.15)`; ctx.fill();
                }
            });
            if (isSpeaking) {
                for (let ring = 0; ring < 4; ring++) {
                    const phase = (pulseT * 0.33 + ring * 0.65) % 1;
                    ctx.beginPath(); ctx.arc(cx, cy, Rb * (0.88 + phase * 0.85), 0, Math.PI * 2);
                    ctx.strokeStyle = `${colors.halo}${(1 - phase) * 0.24})`; ctx.lineWidth = 1.5; ctx.stroke();
                }
            }
            if (isThinking) {
                ctx.save(); ctx.translate(cx, cy); ctx.rotate(timeRef.current * 5);
                ctx.beginPath(); ctx.arc(0, 0, Rb * 1.16, 0, Math.PI * 1.5);
                ctx.strokeStyle = `${colors.thinkArc}0.55)`; ctx.lineWidth = 1.5; ctx.setLineDash([5, 8]); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
            }
            if (isListening) {
                ctx.beginPath(); ctx.arc(cx, cy, Rb * 1.12, 0, Math.PI * 2);
                ctx.strokeStyle = `${colors.listenRing}${0.22 + Math.sin(pulseT * 3) * 0.10})`; ctx.lineWidth = 1.2; ctx.stroke();
            }
            animRef.current = requestAnimationFrame(draw);
        }
        animRef.current = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animRef.current);
    }, []);

    const [light, setLight] = useState(false);
    useEffect(() => {
        setLight(isLightTheme());
        const obs = new MutationObserver(() => setLight(isLightTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => obs.disconnect();
    }, []);

    const darkColors: Record<AgentState, string> = { initializing: '#c8922a', idle: '#8a7040', listening: '#2dd4a0', thinking: '#e8c060', speaking: '#e8ac44' };
    const lightColors: Record<AgentState, string> = { initializing: '#40916c', idle: '#8a9480', listening: '#2d6a4f', thinking: '#bc6c25', speaking: '#40916c' };
    const stateLabels: Record<AgentState, string> = { initializing: 'INIT', idle: 'READY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'SPEAKING' };
    const stateColor = light ? lightColors[state] : darkColors[state];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
            <canvas ref={canvasRef} style={{
                display: 'block',
                filter: state === 'speaking'
                    ? light ? 'drop-shadow(0 0 28px rgba(45,106,79,0.50))' : 'drop-shadow(0 0 28px rgba(200,146,42,0.50))'
                    : state === 'listening'
                        ? light ? 'drop-shadow(0 0 18px rgba(45,106,79,0.40))' : 'drop-shadow(0 0 16px rgba(45,212,160,0.35))'
                        : light ? 'drop-shadow(0 0 14px rgba(45,106,79,0.25))' : 'drop-shadow(0 0 12px rgba(200,146,42,0.22))',
                transition: 'filter 0.6s ease',
            }} />
            <div style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '5px 14px', borderRadius: '100px',
                border: `1px solid ${stateColor}30`,
                background: `${stateColor}14`,
                backdropFilter: 'blur(12px)', transition: 'all 0.4s ease',
            }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: stateColor, boxShadow: `0 0 8px ${stateColor}aa`, animation: (state === 'speaking' || state === 'listening') ? 'pulse-soft 1.8s ease infinite' : 'none', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: stateColor, letterSpacing: '0.1em' }}>{stateLabels[state]}</span>
            </div>
        </div>
    );
}

// ── Chat card types & inline cards (unchanged from original) ─────────────────

type ChatCardItem = | { kind: 'weather'; data: WeatherData } | { kind: 'calculator'; data: CalcData };

function InlineWeatherCard({ data, light }: { data: WeatherData; light: boolean }) {
    const tempRounded = Math.round(data.temperature_c);
    const feelsRounded = Math.round(data.feels_like_c);
    if (light) {
        return (
            <div style={{ borderRadius: '14px', background: 'linear-gradient(135deg, rgba(45,106,79,0.08) 0%, rgba(64,145,108,0.04) 100%)', border: '1px solid rgba(45,106,79,0.18)', padding: '12px 14px', boxShadow: '0 2px 12px rgba(30,40,25,0.08)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '-12px', right: '-12px', width: '60px', height: '60px', borderRadius: '50%', background: 'rgba(45,106,79,0.06)', pointerEvents: 'none' }} />
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: '#40916c', letterSpacing: '0.12em', textTransform: 'uppercase' as const, fontWeight: 700 }}>WEATHER</span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: '#1a1a14', marginBottom: '2px' }}>{data.city}</div>
                        <div style={{ fontFamily: 'var(--font-ui)', fontSize: '11px', color: '#4a5240', textTransform: 'capitalize' as const }}>{data.description}</div>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                            {[{ label: '💧', val: `${data.humidity_pct}%` }, { label: '🍃', val: `${data.wind_kmh}km/h` }, { label: '👁', val: `${data.visibility_km}km` }].map(s => (
                                <div key={s.label} style={{ textAlign: 'center' as const }}>
                                    <div style={{ fontSize: '11px' }}>{s.label}</div>
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#2d6a4f', fontWeight: 700 }}>{s.val}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: '32px', lineHeight: 1, textAlign: 'right' as const }}>{data.weather_emoji}</div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: '#2d6a4f', letterSpacing: '-0.04em', textAlign: 'right' as const, lineHeight: 1.1 }}>{tempRounded}°</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#8a9480', textAlign: 'right' as const }}>feels {feelsRounded}°</div>
                    </div>
                </div>
            </div>
        );
    }
    const desc = data.description.toLowerCase();
    let accent = '#5ba4f5';
    if (desc.includes('sun') || desc.includes('clear')) accent = '#e8ac44';
    else if (desc.includes('rain') || desc.includes('drizzle')) accent = '#38bdf8';
    else if (desc.includes('snow')) accent = '#93c5fd';
    else if (desc.includes('storm') || desc.includes('thunder')) accent = '#a78bfa';
    return (
        <div style={{ borderRadius: '14px', background: `linear-gradient(135deg, ${accent}14, ${accent}06)`, border: `1px solid ${accent}28`, padding: '12px 14px', boxShadow: `0 2px 12px rgba(0,0,0,0.20), 0 0 0 1px ${accent}10` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: `${accent}cc`, letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: '4px' }}>WEATHER</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700, color: '#eeeef2', marginBottom: '2px' }}>{data.city}</div>
                    <div style={{ fontFamily: 'var(--font-ui)', fontSize: '11px', color: '#8b8b9e', textTransform: 'capitalize' as const }}>{data.description}</div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                        {[{ label: '💧', val: `${data.humidity_pct}%` }, { label: '💨', val: `${data.wind_kmh}km/h` }, { label: '👁', val: `${data.visibility_km}km` }].map(s => (
                            <div key={s.label} style={{ textAlign: 'center' as const }}>
                                <div style={{ fontSize: '11px' }}>{s.label}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: accent, fontWeight: 700 }}>{s.val}</div>
                            </div>
                        ))}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: '32px', lineHeight: 1, textAlign: 'right' as const }}>{data.weather_emoji}</div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 800, color: accent, letterSpacing: '-0.04em', textAlign: 'right' as const, lineHeight: 1.1 }}>{tempRounded}°</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#4a4a5c', textAlign: 'right' as const }}>feels {feelsRounded}°</div>
                </div>
            </div>
        </div>
    );
}

function InlineCalcCard({ data, light }: { data: CalcData; light: boolean }) {
    if (light) {
        return (
            <div style={{ borderRadius: '14px', background: 'linear-gradient(135deg, rgba(45,106,79,0.08) 0%, rgba(64,145,108,0.04) 100%)', border: '1px solid rgba(45,106,79,0.18)', padding: '12px 14px', boxShadow: '0 2px 12px rgba(30,40,25,0.08)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: '#40916c', letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: '8px', fontWeight: 700 }}>CALCULATION</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: '#4a5240', padding: '6px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(45,106,79,0.12)', marginBottom: '8px', wordBreak: 'break-all' as const }}>{data.expression}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#8a9480' }}>→</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, color: '#2d6a4f', letterSpacing: '-0.03em' }}>{data.formatted}</span>
                </div>
            </div>
        );
    }
    return (
        <div style={{ borderRadius: '14px', background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(20,184,166,0.06))', border: '1px solid rgba(139,92,246,0.22)', padding: '12px 14px', boxShadow: '0 2px 12px rgba(0,0,0,0.20)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '8px', color: '#8b5cf6', letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: '8px' }}>CALCULATION</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'rgba(255,255,255,0.65)', padding: '6px 10px', borderRadius: '8px', background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(139,92,246,0.15)', marginBottom: '8px', wordBreak: 'break-all' as const }}>{data.expression}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: '#14b8a6' }}>→</span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 800, color: '#fff', letterSpacing: '-0.03em', textShadow: '0 0 20px rgba(139,92,246,0.5)' }}>{data.formatted}</span>
            </div>
        </div>
    );
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ item, light, cards }: { item: ConversationItem; light: boolean; cards?: ChatCardItem[] }) {
    const isUser = item.role === 'user';
    const isSystem = item.role === 'system';
    return (
        <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'flex', justifyContent: isSystem ? 'center' : isUser ? 'flex-end' : 'flex-start', marginBottom: '2px' }}
        >
            {(!isUser && !isSystem) && (
                <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: light ? 'linear-gradient(135deg, #40916c, #2d6a4f)' : 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '10px', color: light ? '#fff' : '#0c0a06', flexShrink: 0, marginRight: '8px', marginTop: '2px', alignSelf: 'flex-end', boxShadow: light ? '0 2px 8px rgba(45,106,79,0.25)' : 'none' }}>J</div>
            )}
            <div style={{ maxWidth: isSystem ? '90%' : '72%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ padding: isSystem ? '8px 16px' : '10px 14px', borderRadius: isUser ? 'var(--r-lg) var(--r-lg) 4px var(--r-lg)' : isSystem ? '100px' : 'var(--r-lg) var(--r-lg) var(--r-lg) 4px', background: isSystem ? 'var(--bg-glass)' : isUser ? light ? 'rgba(45,106,79,0.08)' : 'var(--bubble-user)' : light ? 'rgba(255,255,255,0.92)' : 'var(--bubble-agent)', border: isSystem ? '1px solid var(--border-mid)' : isUser ? light ? '1px solid rgba(45,106,79,0.14)' : '1px solid var(--border-dim)' : light ? '1px solid rgba(45,106,79,0.10)' : '1px solid var(--border-dim)', backdropFilter: 'blur(16px)', boxShadow: light ? isUser ? '0 1px 4px rgba(30,40,25,0.07)' : '0 2px 8px rgba(30,40,25,0.08)' : 'var(--shadow-xs)', fontSize: isSystem ? '13px' : '14px', lineHeight: 1.65, color: light ? isSystem ? '#4a5240' : isUser ? '#1a1a14' : '#1a1a14' : isSystem ? 'var(--text-secondary)' : 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontWeight: isSystem ? 400 : 300, wordBreak: 'break-word' as const, textAlign: isSystem ? 'center' as const : 'left' as const }}>{item.content}</div>
                {cards && cards.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '280px', marginTop: '2px' }}>
                        {cards.map((card, idx) => (
                            <div key={idx}>
                                {card.kind === 'weather' && <InlineWeatherCard data={card.data} light={light} />}
                                {card.kind === 'calculator' && <InlineCalcCard data={card.data} light={light} />}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function ThinkingBubble({ light }: { light: boolean }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
            <div style={{ width: '22px', height: '22px', borderRadius: '50%', background: light ? 'linear-gradient(135deg, #40916c, #2d6a4f)' : 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '10px', color: light ? '#fff' : '#0c0a06', flexShrink: 0, boxShadow: light ? '0 2px 8px rgba(45,106,79,0.25)' : 'none' }}>J</div>
            <div style={{ padding: '12px 16px', borderRadius: 'var(--r-lg) var(--r-lg) var(--r-lg) 4px', background: light ? 'rgba(255,255,255,0.92)' : 'var(--bubble-agent)', border: light ? '1px solid rgba(45,106,79,0.10)' : '1px solid var(--border-dim)', display: 'flex', gap: '5px', alignItems: 'center', boxShadow: light ? '0 2px 8px rgba(30,40,25,0.08)' : 'none' }}>
                {[0, 0.18, 0.36].map((delay, i) => (
                    <span key={i} style={{ width: '5px', height: '5px', borderRadius: '50%', background: light ? 'rgba(45,106,79,0.35)' : 'var(--text-muted)', display: 'block', animation: `shimmer-dots 1.4s ease ${delay}s infinite` }} />
                ))}
            </div>
        </div>
    );
}

// ── Inner session ─────────────────────────────────────────────────────────────

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

    const [light, setLight] = useState(false);
    useEffect(() => {
        setLight(isLightTheme());
        const obs = new MutationObserver(() => setLight(isLightTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => obs.disconnect();
    }, []);

    const [chatCards, setChatCards] = useState<Map<string, ChatCardItem[]>>(new Map());

    const handleCardAction = useCallback((type: 'weather' | 'calculator', data: WeatherData | CalcData) => {
        const card: ChatCardItem = type === 'weather' ? { kind: 'weather', data: data as WeatherData } : { kind: 'calculator', data: data as CalcData };
        setChatCards(prev => { const next = new Map(prev); const pending = next.get('attach-next') || []; next.set('attach-next', [...pending, card]); return next; });
    }, []);

    useEffect(() => {
        if (!sessionStarted.current && agentState !== 'initializing') { sessionStarted.current = true; setTimeout(() => playSound('session_start'), 400); }
    }, [agentState]);

    useEffect(() => {
        if (!agentTranscriptions?.length) return;
        const current = agentTranscriptions.slice(transcriptStartIndex.current);
        const text = current.map(t => t.text).join('').trim();
        if (text) setStreamingAgent(text);
    }, [agentTranscriptions]);

    useEffect(() => {
        const wasNotSpeaking = prevState.current !== 'speaking', wasSpeaking = prevState.current === 'speaking';
        const nowSpeaking = agentState === 'speaking', nowNotSpeaking = agentState !== 'speaking';
        if (nowSpeaking && wasNotSpeaking) { transcriptStartIndex.current = agentTranscriptions?.length ?? 0; setStreamingAgent(''); }
        if (wasSpeaking && nowNotSpeaking) {
            if (streamingAgentText.trim() && streamingAgentText.trim() !== lastAgentMsg.current) {
                lastAgentMsg.current = streamingAgentText.trim();
                const newItem: ConversationItem = { role: 'assistant', content: streamingAgentText.trim(), timestamp: Date.now(), id: `agent-stream-${Date.now()}` };
                addItem(newItem);
                setChatCards(prev => { const pending = prev.get('attach-next'); if (!pending || pending.length === 0) return prev; const next = new Map(prev); next.delete('attach-next'); const existing = next.get(newItem.id) || []; next.set(newItem.id, [...existing, ...pending]); return next; });
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
                lastAgentMsg.current = item.content; setStreamingAgent('');
                const newItem = { ...item }; addItem(newItem);
                setChatCards(prev => { const pending = prev.get('attach-next'); if (!pending || pending.length === 0) return prev; const next = new Map(prev); next.delete('attach-next'); const existing = next.get(newItem.id) || []; next.set(newItem.id, [...existing, ...pending]); return next; });
            }
        },
    });

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, interimText, agentState, streamingAgentText]);

    const handleSend = useCallback(() => {
        const text = textValue.trim(); if (!text) return;
        addUserTyped(text); sendText(text); setTextValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }, [textValue, addUserTyped, sendText]);

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };
    const onInput = () => { const el = textareaRef.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 120)}px`; };

    const isConnected = lkState !== 'disconnected';
    const allMessages: ConversationItem[] = streamingAgentText
        ? [...messages, { role: 'assistant' as const, content: streamingAgentText, timestamp: Date.now(), id: 'streaming-now' }]
        : messages;
    const hasMessages = allMessages.length > 0 || !!interimText;
    const sendActive = textValue.trim() && isConnected;
    const sendBg = sendActive ? light ? '#2d6a4f' : 'var(--gold)' : light ? 'rgba(45,106,79,0.06)' : 'var(--bg-glass)';
    const sendColor = sendActive ? light ? '#fff' : '#0c0a06' : 'var(--text-muted)';

    return (
        <div style={{ position: 'fixed', inset: 0, top: '56px', display: 'flex', flexDirection: 'column', background: 'var(--bg-void)', overflow: 'hidden', transition: 'background 0.35s ease' }}>
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: light ? 'radial-gradient(ellipse 50% 60% at 25% 40%, rgba(45,106,79,0.05) 0%, transparent 70%), radial-gradient(ellipse 40% 50% at 75% 60%, rgba(188,108,37,0.03) 0%, transparent 60%)' : 'radial-gradient(ellipse 50% 60% at 25% 40%, rgba(200,146,42,0.04) 0%, transparent 70%), radial-gradient(ellipse 40% 50% at 75% 60%, rgba(93,164,245,0.03) 0%, transparent 60%)' }} />
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.018, backgroundImage: light ? 'linear-gradient(rgba(45,106,79,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(45,106,79,0.18) 1px, transparent 1px)' : 'linear-gradient(var(--border-mid) 1px, transparent 1px), linear-gradient(90deg, var(--border-mid) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
            <div className="noise-overlay" />

            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
                <motion.div
                    animate={{ width: hasMessages ? '280px' : '100%' }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: '24px 20px', borderRight: hasMessages ? `1px solid ${light ? 'rgba(45,106,79,0.12)' : 'var(--border-dim)'}` : 'none', position: 'relative', zIndex: 2 }}
                >
                    <AgentOrb state={agentState} />
                    {!hasMessages && (
                        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.5 }} style={{ marginTop: '32px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                            <p style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Jocasta is ready</p>
                            <p style={{ fontFamily: 'var(--font-ui)', fontSize: '13px', fontWeight: 300, color: 'var(--text-muted)', maxWidth: '280px', lineHeight: 1.6 }}>Speak or type below to begin. Ask about weather, news, calculations, or anything at all.</p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 16px', borderRadius: '100px', border: light ? '1px dashed rgba(45,106,79,0.25)' : '1px dashed var(--border-mid)', color: light ? '#8a9480' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em', marginTop: '4px' }}>
                                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="1" width="4" height="6" rx="2" stroke="currentColor" strokeWidth="1.2" /><path d="M2 6a4 4 0 008 0M6 10v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                                VOICE ACTIVE
                            </div>
                        </motion.div>
                    )}
                </motion.div>

                <AnimatePresence>
                    {hasMessages && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}>
                            <div style={{ flexShrink: 0, padding: '12px 20px', borderBottom: light ? '1px solid rgba(45,106,79,0.10)' : '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: light ? 'rgba(250,247,242,0.95)' : 'var(--bg-glass)', backdropFilter: 'blur(16px)', transition: 'background 0.35s ease' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1" y="1" width="11" height="9" rx="1.5" stroke="var(--text-muted)" strokeWidth="1.1" /><path d="M3 5h7M3 7.5h5" stroke="var(--text-muted)" strokeWidth="1.1" strokeLinecap="round" /></svg>
                                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>TRANSCRIPT — {allMessages.length} {allMessages.length === 1 ? 'MESSAGE' : 'MESSAGES'}</span>
                                </div>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {allMessages.map(item => (<MessageBubble key={item.id} item={item} light={light} cards={chatCards.get(item.id)} />))}
                                {interimText && (
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <div style={{ maxWidth: '72%', padding: '10px 14px', borderRadius: 'var(--r-lg) var(--r-lg) 4px var(--r-lg)', background: light ? 'rgba(45,106,79,0.06)' : 'var(--bubble-user)', border: light ? '1px dashed rgba(45,106,79,0.20)' : '1px dashed var(--border-mid)', color: 'var(--text-muted)', fontSize: '14px', fontStyle: 'italic', fontFamily: 'var(--font-ui)' }}>
                                            {interimText}
                                            <span style={{ marginLeft: '2px', color: light ? '#40916c' : 'var(--gold)', animation: 'cursor-blink 1s step-end infinite' }}>|</span>
                                        </div>
                                    </div>
                                )}
                                {agentState === 'thinking' && <ThinkingBubble light={light} />}
                                <div ref={bottomRef} />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div style={{ flexShrink: 0, borderTop: light ? '1px solid rgba(45,106,79,0.10)' : '1px solid var(--bar-border)', background: 'var(--bar-bg)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)', position: 'relative', zIndex: 20, transition: 'background 0.35s ease, border-color 0.35s ease', boxShadow: light ? '0 -4px 24px rgba(30,40,25,0.06)' : '0 -4px 24px rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 20px 0' }}>
                    <VoiceAssistantControlBar />
                </div>
                <div style={{ maxWidth: '720px', margin: '0 auto', width: '100%', padding: '10px 20px 14px', display: 'flex', alignItems: 'flex-end', gap: '10px' }}>
                    <textarea ref={textareaRef} value={textValue} onChange={e => setTextValue(e.target.value)} onKeyDown={onKeyDown} onInput={onInput} placeholder="Type a message…" disabled={!isConnected} rows={1} style={{ flex: 1, padding: '10px 14px', borderRadius: '12px', border: light ? '1px solid rgba(45,106,79,0.20)' : '1px solid var(--border-mid)', background: light ? '#ffffff' : 'var(--bg-raised)', color: 'var(--text-primary)', fontFamily: 'var(--font-ui)', fontSize: '14px', lineHeight: 1.55, resize: 'none', outline: 'none', minHeight: '42px', maxHeight: '120px', overflowY: 'auto', transition: 'border-color 0.2s, background 0.3s, color 0.3s, box-shadow 0.2s', boxShadow: light ? '0 1px 4px rgba(30,40,25,0.06)' : 'none' }} onFocus={e => { e.target.style.borderColor = light ? '#2d6a4f' : 'var(--gold)'; e.target.style.boxShadow = light ? '0 0 0 3px rgba(45,106,79,0.12), 0 1px 4px rgba(30,40,25,0.06)' : '0 0 0 3px var(--gold-dim)'; }} onBlur={e => { e.target.style.borderColor = light ? 'rgba(45,106,79,0.20)' : 'var(--border-mid)'; e.target.style.boxShadow = light ? '0 1px 4px rgba(30,40,25,0.06)' : 'none'; }} />
                    <button onClick={handleSend} disabled={!sendActive} title="Send (Enter)" style={{ width: '42px', height: '42px', borderRadius: '12px', background: sendBg, border: sendActive ? light ? '1px solid rgba(45,106,79,0.35)' : '1px solid var(--gold-glow)' : light ? '1px solid rgba(45,106,79,0.12)' : '1px solid var(--border-mid)', color: sendColor, cursor: sendActive ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '18px', transition: 'all 0.2s', boxShadow: sendActive ? light ? '0 4px 16px rgba(45,106,79,0.25)' : '0 4px 16px var(--gold-glow)' : 'none' }}>↑</button>
                </div>
            </div>

            <RoomAudioRenderer />
            <ClientToolHandler onSystemMessage={(msg) => addItem({ role: 'system', content: msg, timestamp: Date.now(), id: `sys-${Date.now()}` })} onCardAction={handleCardAction} />
            <CardOverlay />
        </div>
    );
}

// ── Root export ───────────────────────────────────────────────────────────────

export function VoiceAgent() {
    const [conn, setConn] = useState<TokenResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const startSession = useCallback(async () => {
        setLoading(true); setError(null);
        try { setConn(await fetchToken()); }
        catch { setError('Could not connect. Make sure the backend is running.'); }
        finally { setLoading(false); }
    }, []);

    if (!conn) {
        return (
            <PreSessionScreen
                onStart={startSession}
                loading={loading}
                error={error}
            />
        );
    }

    return (
        <LiveKitRoom
            serverUrl={conn.url} token={conn.token}
            connect={true} audio={true} video={false}
            onDisconnected={() => setConn(null)}
            style={{ height: '100%', background: 'transparent' }}
        >
            <JocastaSession />
        </LiveKitRoom>
    );
}