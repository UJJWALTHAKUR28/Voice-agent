'use client';

// components/ClientToolHandler.tsx
// Fix: Added card deduplication so cards don't repeat when agent is interrupted
// and restarts the same tool call (weather → interrupted → agent re-speaks → duplicate card)
//
// Strategy:
//   • Each card gets a stable hash key: type + city/expression + minute-window
//   • If the same card arrives within 60s, it's suppressed (dedup window)
//   • CardOverlay uses AnimatePresence so exits are animated

import { useEffect, useCallback, useState, useRef } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { applyTheme } from '@/utils/theme';
import { pushToast } from './Themetoast';
import { motion, AnimatePresence } from 'motion/react';

interface ClientToolMsg {
    type: 'client_tool';
    action: string;
    data: Record<string, unknown>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WeatherData {
    city: string;
    temperature_c: number;
    temperature_f: number;
    feels_like_c: number;
    description: string;
    humidity_pct: number;
    wind_kmh: number;
    visibility_km: number;
    weather_emoji: string;
}

export interface CalcData {
    expression: string;
    result: number;
    formatted: string;
}

type ActiveCard =
    | { type: 'weather'; data: WeatherData; id: string }
    | { type: 'calculator'; data: CalcData; id: string };

// ── Deduplication helpers ─────────────────────────────────────────────────────

function weatherKey(d: WeatherData): string {
    // Same city + within the same minute = same card
    const minute = Math.floor(Date.now() / 60_000);
    return `weather:${d.city.toLowerCase()}:${minute}`;
}

function calcKey(d: CalcData): string {
    // Same expression + within 60 seconds = same card
    const minute = Math.floor(Date.now() / 60_000);
    return `calc:${d.expression.replace(/\s/g, '')}:${minute}`;
}

// ── Theme detection ───────────────────────────────────────────────────────────

function isLightTheme(): boolean {
    if (typeof window === 'undefined') return false;
    return (
        document.documentElement.hasAttribute('data-theme') ||
        document.documentElement.classList.contains('light')
    );
}

// ── Sound ─────────────────────────────────────────────────────────────────────

function createAudioContext(): AudioContext | null {
    try {
        return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { return null; }
}

const soundLibrary: Record<string, (ctx: AudioContext) => void> = {
    session_start: (ctx) => {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.setValueAtTime(freq, ctx.currentTime);
            const t = ctx.currentTime + i * 0.12;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t); osc.stop(t + 0.55);
        });
    },
    notification: (ctx) => {
        [880, 1100].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.15;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.14, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            osc.start(t); osc.stop(t + 0.45);
        });
    },
    success: (ctx) => {
        [698.46, 880, 1046.5].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'triangle'; osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.1;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.15, t + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            osc.start(t); osc.stop(t + 0.65);
        });
    },
    error: (ctx) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
    },
    click: (ctx) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
    },
    card_appear: (ctx) => {
        [523.25, 783.99].forEach((freq, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = 'sine'; osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.08;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.10, t + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t); osc.stop(t + 0.55);
        });
    },
};

export function playSound(soundName: string) {
    const ctx = createAudioContext();
    if (!ctx) return;
    const fn = soundLibrary[soundName] ?? soundLibrary['notification'];
    fn(ctx);
}

// ── Weather condition theme ───────────────────────────────────────────────────

interface WeatherTheme {
    darkGradient: string; darkAccent: string; darkBar: string;
    lightGradient: string; lightAccent: string; lightAccentRgb: string;
    lightBar: string; lightBorder: string; lightIcon: string;
}

function getWeatherTheme(description: string): WeatherTheme {
    const d = description.toLowerCase();
    if (d.includes('thunder') || d.includes('storm')) return {
        darkGradient: 'linear-gradient(145deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        darkAccent: '#a78bfa', darkBar: '#a78bfa',
        lightGradient: 'linear-gradient(145deg, #f0f5f1 0%, #e4efe7 50%, #d4e7d9 100%)',
        lightAccent: '#1a5c3a', lightAccentRgb: '26,92,58', lightBar: '#2e7d52',
        lightBorder: 'rgba(26,92,58,0.18)', lightIcon: 'rgba(26,92,58,0.12)',
    };
    if (d.includes('snow') || d.includes('blizzard') || d.includes('sleet')) return {
        darkGradient: 'linear-gradient(145deg, #dbeafe 0%, #bfdbfe 50%, #93c5fd 100%)',
        darkAccent: '#1d4ed8', darkBar: '#3b82f6',
        lightGradient: 'linear-gradient(145deg, #f2f7f3 0%, #e6f1e9 50%, #d8eadd 100%)',
        lightAccent: '#2e7d52', lightAccentRgb: '46,125,82', lightBar: '#52a871',
        lightBorder: 'rgba(46,125,82,0.16)', lightIcon: 'rgba(82,168,113,0.15)',
    };
    if (d.includes('rain') || d.includes('drizzle') || d.includes('shower')) return {
        darkGradient: 'linear-gradient(145deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
        darkAccent: '#38bdf8', darkBar: '#38bdf8',
        lightGradient: 'linear-gradient(145deg, #eef4f0 0%, #e2ede5 50%, #d3e6d9 100%)',
        lightAccent: '#1a5c3a', lightAccentRgb: '26,92,58', lightBar: '#2e7d52',
        lightBorder: 'rgba(26,92,58,0.18)', lightIcon: 'rgba(26,92,58,0.10)',
    };
    if (d.includes('cloud') || d.includes('overcast') || d.includes('fog') || d.includes('mist') || d.includes('haze')) return {
        darkGradient: 'linear-gradient(145deg, #374151 0%, #4b5563 50%, #6b7280 100%)',
        darkAccent: '#d1d5db', darkBar: '#9ca3af',
        lightGradient: 'linear-gradient(145deg, #f3f5f2 0%, #eaede8 50%, #dde2da 100%)',
        lightAccent: '#3d5c42', lightAccentRgb: '61,92,66', lightBar: '#5a7c5e',
        lightBorder: 'rgba(61,92,66,0.16)', lightIcon: 'rgba(90,124,94,0.12)',
    };
    // Sunny / clear
    return {
        darkGradient: 'linear-gradient(145deg, #92400e 0%, #b45309 40%, #d97706 80%, #fbbf24 100%)',
        darkAccent: '#fef08a', darkBar: '#fbbf24',
        lightGradient: 'linear-gradient(145deg, #f0f6f1 0%, #e2efe5 50%, #cfe5d5 100%)',
        lightAccent: '#1a5c3a', lightAccentRgb: '26,92,58', lightBar: '#52a871',
        lightBorder: 'rgba(26,92,58,0.20)', lightIcon: 'rgba(26,92,58,0.10)',
    };
}

// ── Progress bar style injection ──────────────────────────────────────────────

const PROGRESS_CSS = `
  @keyframes progress-shrink {
    from { transform: scaleX(1); }
    to   { transform: scaleX(0); }
  }
`;

// ── Weather Card ──────────────────────────────────────────────────────────────

function WeatherCard({ data, onClose }: { data: WeatherData; onClose: () => void }) {
    const [light, setLight] = useState(false);
    const [closing, setClosing] = useState(false);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        setLight(isLightTheme());
        const obs = new MutationObserver(() => setLight(isLightTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => obs.disconnect();
    }, []);

    // Auto-dismiss after 6 seconds (increased from 3 for readability)
    useEffect(() => {
        const t = setTimeout(() => { setClosing(true); setTimeout(() => onCloseRef.current(), 350); }, 6000);
        return () => clearTimeout(t);
    }, []);

    const handleClose = () => { setClosing(true); setTimeout(onClose, 350); };

    const tempRounded = Math.round(data.temperature_c);
    const feelsRounded = Math.round(data.feels_like_c);
    const theme = getWeatherTheme(data.description);
    const tempBarPct = Math.min(100, Math.max(0, (tempRounded / 40) * 100));

    const baseCardStyle: React.CSSProperties = {
        position: 'relative', borderRadius: 22, overflow: 'hidden',
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateY(8px) scale(0.97)' : 'none',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
    };

    // Shared close button
    const closeBtn = (style: React.CSSProperties) => (
        <button onClick={handleClose} style={{
            position: 'absolute', top: 14, right: 14,
            width: 26, height: 26, borderRadius: '50%',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, zIndex: 10, backdropFilter: 'blur(8px)',
            transition: 'all 0.15s ease', ...style,
        }}>✕</button>
    );

    if (light) {
        return (
            <div style={{
                ...baseCardStyle,
                background: theme.lightGradient,
                border: `1px solid ${theme.lightBorder}`,
                boxShadow: `0 1px 0 rgba(255,255,255,0.95) inset, 0 24px 56px rgba(15,40,20,0.14), 0 6px 16px rgba(15,40,20,0.08)`,
            }}>
                <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse 130% 80% at 70% -10%, rgba(255,255,255,0.65) 0%, transparent 55%)`, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '100%', background: `linear-gradient(90deg, ${theme.lightAccent}, ${theme.lightBar})`, animation: 'progress-shrink 6s linear forwards', transformOrigin: 'left' }} />
                </div>
                {closeBtn({ background: 'rgba(255,255,255,0.50)', border: `1px solid ${theme.lightBorder}`, color: theme.lightAccent })}

                <div style={{ padding: '22px 22px 18px', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: '#0f1a12', letterSpacing: '-0.02em' }}>{data.city}</div>
                            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: theme.lightAccent, marginTop: 2, textTransform: 'capitalize', fontWeight: 500, opacity: 0.8 }}>{data.description}</div>
                        </div>
                        <div style={{ fontSize: 50, lineHeight: 1, marginTop: -4, filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.15))' }}>{data.weather_emoji}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 10 }}>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 64, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1, color: theme.lightAccent, textShadow: `0 2px 20px rgba(${theme.lightAccentRgb},0.20)` }}>{tempRounded}°</div>
                        <div style={{ paddingBottom: 10 }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#354a36' }}>C / {Math.round(data.temperature_f)}°F</div>
                            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: '#7a9478', fontWeight: 300 }}>feels {feelsRounded}°</div>
                        </div>
                    </div>
                    <div style={{ marginBottom: 18 }}>
                        <div style={{ height: 6, borderRadius: 100, background: 'rgba(255,255,255,0.40)', border: `1px solid ${theme.lightBorder}`, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${tempBarPct}%`, borderRadius: 100, background: `linear-gradient(90deg, ${theme.lightAccent}, ${theme.lightBar})`, boxShadow: `0 0 10px rgba(${theme.lightAccentRgb},0.35)`, transition: 'width 1.2s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontFamily: 'var(--font-mono)', fontSize: 9, color: '#7a9478', letterSpacing: '0.06em' }}>
                            <span>0°C</span><span>40°C</span>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                        {[{ emoji: '💧', label: 'Humidity', value: `${data.humidity_pct}%` }, { emoji: '🌿', label: 'Wind', value: `${data.wind_kmh}km/h` }, { emoji: '🌱', label: 'Visibility', value: `${data.visibility_km}km` }].map(stat => (
                            <div key={stat.label} style={{ padding: '10px 8px', borderRadius: 12, background: 'rgba(255,255,255,0.60)', border: '1px solid rgba(255,255,255,0.80)', textAlign: 'center', backdropFilter: 'blur(12px)', boxShadow: '0 2px 6px rgba(15,40,20,0.07)' }}>
                                <div style={{ fontSize: 15, marginBottom: 4 }}>{stat.emoji}</div>
                                <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: theme.lightAccent, letterSpacing: '-0.01em' }}>{stat.value}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#7a9478', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ ...baseCardStyle, background: theme.darkGradient, boxShadow: '0 2px 1px rgba(255,255,255,0.10) inset, 0 -1px 1px rgba(0,0,0,0.20) inset, 0 24px 60px rgba(0,0,0,0.45), 0 8px 24px rgba(0,0,0,0.30)' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', background: theme.darkBar, animation: 'progress-shrink 6s linear forwards', transformOrigin: 'left' }} />
            </div>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '40%', background: 'linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 100%)', borderRadius: '22px 22px 0 0', pointerEvents: 'none' }} />
            {closeBtn({ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', color: 'rgba(255,255,255,0.80)' })}

            <div style={{ padding: '22px 22px 18px', position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 4 }}>CURRENT CONDITIONS</div>
                        <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.01em' }}>{data.city}</div>
                        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 12, color: 'rgba(255,255,255,0.70)', marginTop: 2, textTransform: 'capitalize', fontWeight: 300 }}>{data.description}</div>
                    </div>
                    <div style={{ fontSize: 52, lineHeight: 1, marginTop: -6, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.4))' }}>{data.weather_emoji}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginBottom: 6 }}>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 64, fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 1, color: '#fff' }}>{tempRounded}°</div>
                    <div style={{ paddingBottom: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>C / {Math.round(data.temperature_f)}°F</div>
                        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: 300 }}>feels {feelsRounded}°</div>
                    </div>
                </div>
                <div style={{ marginBottom: 18 }}>
                    <div style={{ height: 4, borderRadius: 100, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${tempBarPct}%`, borderRadius: 100, background: theme.darkBar, boxShadow: `0 0 8px ${theme.darkBar}80`, transition: 'width 1s ease' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>
                        <span>0°C</span><span>40°C</span>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {[{ emoji: '💧', label: 'Humidity', value: `${data.humidity_pct}%` }, { emoji: '💨', label: 'Wind', value: `${data.wind_kmh}km/h` }, { emoji: '👁', label: 'Visibility', value: `${data.visibility_km}km` }].map(stat => (
                        <div key={stat.label} style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(8px)', textAlign: 'center' }}>
                            <div style={{ fontSize: 16, marginBottom: 4 }}>{stat.emoji}</div>
                            <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#fff' }}>{stat.value}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>{stat.label}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Calculator Card ───────────────────────────────────────────────────────────

function CalculatorCard({ data, onClose }: { data: CalcData; onClose: () => void }) {
    const [light, setLight] = useState(false);
    const [closing, setClosing] = useState(false);
    const onCloseRef = useRef(onClose);
    useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

    useEffect(() => {
        setLight(isLightTheme());
        const obs = new MutationObserver(() => setLight(isLightTheme()));
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
        return () => obs.disconnect();
    }, []);

    useEffect(() => {
        const t = setTimeout(() => { setClosing(true); setTimeout(() => onCloseRef.current(), 350); }, 6000);
        return () => clearTimeout(t);
    }, []);

    const handleClose = () => { setClosing(true); setTimeout(onClose, 350); };
    const isLargeResult = data.formatted.length > 10;
    const isInt = data.result === Math.floor(data.result);

    const baseStyle: React.CSSProperties = {
        position: 'relative', borderRadius: 22, overflow: 'hidden',
        opacity: closing ? 0 : 1,
        transform: closing ? 'translateY(8px) scale(0.97)' : 'none',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
    };

    if (light) {
        return (
            <div style={{ ...baseStyle, background: 'linear-gradient(145deg, #eef4ee 0%, #e4ede6 50%, #d8e7db 100%)', border: '1px solid rgba(26,92,58,0.16)', boxShadow: '0 1px 0 rgba(255,255,255,0.95) inset, 0 24px 56px rgba(15,40,20,0.14), 0 6px 16px rgba(15,40,20,0.08)' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 130% 70% at 75% -10%, rgba(255,255,255,0.70) 0%, transparent 55%)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, #1a5c3a, #52a871)', animation: 'progress-shrink 6s linear forwards', transformOrigin: 'left' }} />
                </div>
                <button onClick={handleClose} style={{ position: 'absolute', top: 14, right: 14, width: 26, height: 26, borderRadius: '50%', background: 'rgba(255,255,255,0.50)', border: '1px solid rgba(26,92,58,0.16)', color: '#1a5c3a', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, zIndex: 10, backdropFilter: 'blur(8px)' }}>✕</button>
                <div style={{ padding: '22px 22px 18px', position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #1a5c3a, #2e7d52)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, boxShadow: '0 4px 14px rgba(26,92,58,0.28)' }}>🧮</div>
                        <div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#7a9478', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700 }}>COMPUTATION</div>
                            <div style={{ fontFamily: 'var(--font-ui)', fontSize: 11, color: '#354a36', fontWeight: 400 }}>Result ready</div>
                        </div>
                    </div>
                    <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.85)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 2px 6px rgba(15,40,20,0.07)', backdropFilter: 'blur(8px)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#2e7d52', letterSpacing: '0.12em', flexShrink: 0, fontWeight: 700, background: 'rgba(26,92,58,0.08)', padding: '2px 6px', borderRadius: 4 }}>IN</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#0f1a12', wordBreak: 'break-all', letterSpacing: '0.02em' }}>{data.expression}</span>
                    </div>
                    <div style={{ padding: '16px 18px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(26,92,58,0.10), rgba(46,125,82,0.06))', border: '1px solid rgba(26,92,58,0.20)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#2e7d52', letterSpacing: '0.12em', fontWeight: 700, background: 'rgba(26,92,58,0.10)', padding: '2px 6px', borderRadius: 4 }}>OUT</span>
                            <div style={{ width: 1, height: 28, background: 'rgba(26,92,58,0.15)' }} />
                            <span style={{ fontFamily: 'var(--font-display)', fontSize: isLargeResult ? 22 : 38, fontWeight: 800, letterSpacing: '-0.03em', color: '#1a5c3a', wordBreak: 'break-all', textShadow: '0 1px 8px rgba(26,92,58,0.15)' }}>{data.formatted}</span>
                        </div>
                        {isInt && <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(26,92,58,0.10)', border: '1px solid rgba(26,92,58,0.20)', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#2e7d52', letterSpacing: '0.06em', flexShrink: 0 }}>INT</div>}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{ ...baseStyle, background: 'linear-gradient(145deg, #0d1117 0%, #161b22 50%, #1c2433 100%)', boxShadow: '0 2px 1px rgba(255,255,255,0.06) inset, 0 -1px 1px rgba(0,0,0,0.3) inset, 0 24px 60px rgba(0,0,0,0.50), 0 8px 24px rgba(0,0,0,0.35)' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', background: 'linear-gradient(90deg, #8b5cf6, #14b8a6)', animation: 'progress-shrink 6s linear forwards', transformOrigin: 'left' }} />
            </div>
            <div style={{ position: 'absolute', top: '-30px', left: '-20px', width: 180, height: 120, background: 'radial-gradient(ellipse, rgba(139,92,246,0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: '-20px', right: '-10px', width: 150, height: 100, background: 'radial-gradient(ellipse, rgba(20,184,166,0.20) 0%, transparent 70%)', pointerEvents: 'none' }} />
            <button onClick={handleClose} style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.60)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, zIndex: 10 }}>✕</button>
            <div style={{ padding: '22px 22px 18px', position: 'relative', zIndex: 1 }}>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, boxShadow: '0 4px 12px rgba(139,92,246,0.4)' }}>🧮</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.40)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>COMPUTATION</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#8b5cf6', letterSpacing: '0.1em', flexShrink: 0 }}>IN</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'rgba(255,255,255,0.75)', wordBreak: 'break-all', letterSpacing: '0.02em' }}>{data.expression}</span>
                </div>
                <div style={{ padding: '16px 18px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(20,184,166,0.08))', border: '1px solid rgba(139,92,246,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#14b8a6', letterSpacing: '0.1em' }}>OUT</span>
                        <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.12)' }} />
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: isLargeResult ? 22 : 36, fontWeight: 800, letterSpacing: '-0.03em', color: '#fff', wordBreak: 'break-all', textShadow: '0 0 30px rgba(139,92,246,0.5)' }}>{data.formatted}</span>
                    </div>
                    {isInt && <div style={{ padding: '4px 8px', borderRadius: 6, background: 'rgba(20,184,166,0.15)', border: '1px solid rgba(20,184,166,0.25)', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#14b8a6', letterSpacing: '0.06em', flexShrink: 0 }}>INT</div>}
                </div>
            </div>
        </div>
    );
}

// ── Card Overlay ──────────────────────────────────────────────────────────────

export function CardOverlay() {
    const [activeCards, setActiveCards] = useState<ActiveCard[]>([]);

    useEffect(() => {
        (window as unknown as { __jocastaPushCard: (card: ActiveCard) => void }).__jocastaPushCard = (newCard) => {
            setActiveCards(prev => [...prev, newCard]);
        };
        return () => { delete (window as unknown as { __jocastaPushCard?: unknown }).__jocastaPushCard; };
    }, []);

    return (
        <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 500, width: 316, maxWidth: 'calc(100vw - 40px)', display: 'flex', flexDirection: 'column', gap: 16, pointerEvents: 'none' }}>
            <style>{PROGRESS_CSS}</style>
            <AnimatePresence mode="popLayout">
                {activeCards.map(card => (
                    <motion.div
                        key={card.id} layout
                        initial={{ opacity: 0, y: 28, scale: 0.90 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                        transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                        style={{ pointerEvents: 'auto', transformOrigin: 'bottom right' }}
                    >
                        {card.type === 'weather' && (
                            <WeatherCard data={card.data as WeatherData} onClose={() => setActiveCards(prev => prev.filter(c => c.id !== card.id))} />
                        )}
                        {card.type === 'calculator' && (
                            <CalculatorCard data={card.data as CalcData} onClose={() => setActiveCards(prev => prev.filter(c => c.id !== card.id))} />
                        )}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

// ── Main handler ──────────────────────────────────────────────────────────────

export function ClientToolHandler({ onSystemMessage, onCardAction }: {
    onSystemMessage?: (text: string) => void;
    onCardAction?: (type: 'weather' | 'calculator', data: WeatherData | CalcData) => void;
}) {
    const room = useRoomContext();

    // Dedup registry: key → timestamp of last push
    const seenCards = useRef<Map<string, number>>(new Map());

    const DEDUP_WINDOW_MS = 60_000; // 60 seconds

    function isDuplicate(key: string): boolean {
        const last = seenCards.current.get(key);
        if (!last) return false;
        return Date.now() - last < DEDUP_WINDOW_MS;
    }

    function markSeen(key: string) {
        seenCards.current.set(key, Date.now());
        // GC old entries
        const cutoff = Date.now() - DEDUP_WINDOW_MS * 2;
        for (const [k, v] of seenCards.current.entries()) {
            if (v < cutoff) seenCards.current.delete(k);
        }
    }

    const runAction = useCallback((action: string, data: Record<string, unknown>) => {
        switch (action) {
            case 'change_theme': {
                const dark = (data.theme as string) !== 'light';
                applyTheme(dark, { sound: true, toast: true });
                break;
            }
            case 'show_notification': {
                const title = (data.title as string) ?? 'Jocasta';
                const message = (data.message as string) ?? '';
                onSystemMessage?.(`🔔 ${title}: ${message}`);
                playSound('notification');
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification(title, { body: message });
                }
                break;
            }
            case 'weather_card': {
                const w = data as unknown as WeatherData;
                const key = weatherKey(w);
                // ─── DEDUP FIX: skip if same card seen within 60s ───
                if (isDuplicate(key)) {
                    console.debug('[ClientToolHandler] weather_card deduped:', key);
                    break;
                }
                markSeen(key);
                playSound('card_appear');
                onCardAction?.('weather', w);
                break;
            }
            case 'calculator_card': {
                const c = data as unknown as CalcData;
                const key = calcKey(c);
                // ─── DEDUP FIX: skip if same expression seen within 60s ───
                if (isDuplicate(key)) {
                    console.debug('[ClientToolHandler] calculator_card deduped:', key);
                    break;
                }
                markSeen(key);
                playSound('card_appear');
                onCardAction?.('calculator', c);
                break;
            }
            case 'open_url': {
                const url = data.url as string;
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
                break;
            }
            case 'play_sound': {
                playSound((data.sound as string) ?? 'notification');
                break;
            }
            default:
                console.warn('[ClientToolHandler] unknown action:', action);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [onSystemMessage, onCardAction]);

    useEffect(() => {
        if (!room) return;
        const onData = (payload: Uint8Array, _p: unknown, _k: unknown, topic?: string) => {
            if (topic !== 'client-tool') return;
            let msg: ClientToolMsg;
            try { msg = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
            if (msg.type === 'client_tool') runAction(msg.action, msg.data ?? {});
        };
        room.on(RoomEvent.DataReceived, onData);
        return () => { room.off(RoomEvent.DataReceived, onData); };
    }, [room, runAction]);

    return null;
}