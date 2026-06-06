'use client';

// components/ClientToolHandler.tsx
//
// Listens for data messages on topic="client-tool" from the Python agent.
// Renders rich UI cards for weather and calculator results.

import { useEffect, useCallback, useState } from 'react';
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

// ── Types for cards ──────────────────────────────────────────────────────────

interface WeatherData {
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

interface CalcData {
    expression: string;
    result: number;
    formatted: string;
}

type ActiveCard =
    | { type: 'weather'; data: WeatherData; id: string }
    | { type: 'calculator'; data: CalcData; id: string }
    | null;

// ── Web Audio sound synthesizer ──────────────────────────────────────────────

function createAudioContext(): AudioContext | null {
    try {
        return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
        return null;
    }
}

const soundLibrary: Record<string, (ctx: AudioContext) => void> = {
    session_start: (ctx) => {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
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
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
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
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
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
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45);
    },
    click: (ctx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.1);
    },
    card_appear: (ctx) => {
        // Soft ascending chime when a card appears
        [523.25, 783.99].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
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

// ── Weather Card ─────────────────────────────────────────────────────────────

function WeatherCard({ data, onClose }: { data: WeatherData; onClose: () => void }) {
    const tempRounded = Math.round(data.temperature_c);
    const feelsRounded = Math.round(data.feels_like_c);

    // Pick background gradient based on description
    const desc = data.description.toLowerCase();
    let gradientFrom = 'rgba(93,164,245,0.12)';
    let gradientTo = 'rgba(45,212,160,0.06)';
    let accentColor = '#5ba4f5';

    if (desc.includes('rain') || desc.includes('drizzle')) {
        gradientFrom = 'rgba(93,130,245,0.14)';
        gradientTo = 'rgba(93,164,245,0.06)';
        accentColor = '#6b8df5';
    } else if (desc.includes('cloud')) {
        gradientFrom = 'rgba(139,139,158,0.12)';
        gradientTo = 'rgba(100,100,120,0.06)';
        accentColor = '#8b8b9e';
    } else if (desc.includes('sun') || desc.includes('clear')) {
        gradientFrom = 'rgba(232,172,68,0.16)';
        gradientTo = 'rgba(200,146,42,0.06)';
        accentColor = '#e8ac44';
    } else if (desc.includes('snow')) {
        gradientFrom = 'rgba(180,220,255,0.14)';
        gradientTo = 'rgba(150,200,255,0.06)';
        accentColor = '#b4dcff';
    } else if (desc.includes('storm') || desc.includes('thunder')) {
        gradientFrom = 'rgba(157,123,234,0.16)';
        gradientTo = 'rgba(100,80,180,0.06)';
        accentColor = '#9d7bea';
    } else if (desc.includes('mist') || desc.includes('fog') || desc.includes('haze')) {
        gradientFrom = 'rgba(160,160,180,0.12)';
        gradientTo = 'rgba(130,130,150,0.06)';
        accentColor = '#a0a0b4';
    }

    return (
        <div style={{
            position: 'relative',
            borderRadius: '20px',
            background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`,
            border: `1px solid ${accentColor}30`,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            overflow: 'hidden',
            boxShadow: `0 8px 40px rgba(0,0,0,0.25), 0 0 0 1px ${accentColor}15`,
        }}>
            {/* Subtle inner glow top */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '60%',
                background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${accentColor}14, transparent)`,
                pointerEvents: 'none',
            }} />

            {/* Close button */}
            <button
                onClick={onClose}
                style={{
                    position: 'absolute', top: '12px', right: '12px',
                    width: '24px', height: '24px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', lineHeight: 1, zIndex: 2,
                    transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.14)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                }}
                onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                }}
            >✕</button>

            <div style={{ padding: '20px 20px 16px', position: 'relative', zIndex: 1 }}>
                {/* City + emoji row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div>
                        <div style={{
                            fontFamily: 'var(--font-mono)', fontSize: '9px',
                            color: `${accentColor}cc`, letterSpacing: '0.12em',
                            textTransform: 'uppercase', marginBottom: '3px',
                        }}>CURRENT WEATHER</div>
                        <div style={{
                            fontFamily: 'var(--font-display)', fontSize: '15px',
                            fontWeight: 700, color: 'var(--text-primary)',
                            letterSpacing: '-0.01em',
                        }}>{data.city}</div>
                        <div style={{
                            fontFamily: 'var(--font-ui)', fontSize: '12px',
                            color: 'var(--text-secondary)', marginTop: '2px',
                            textTransform: 'capitalize',
                        }}>{data.description}</div>
                    </div>
                    <div style={{ fontSize: '42px', lineHeight: 1, marginTop: '-4px', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' }}>
                        {data.weather_emoji}
                    </div>
                </div>

                {/* Big temperature */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', marginBottom: '16px' }}>
                    <div style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '52px', fontWeight: 800,
                        letterSpacing: '-0.04em', lineHeight: 1,
                        color: 'var(--text-primary)',
                    }}>{tempRounded}°</div>
                    <div style={{ paddingBottom: '8px' }}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>C</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', opacity: 0.6 }}>
                            {Math.round(data.temperature_f)}°F
                        </div>
                    </div>
                    <div style={{ paddingBottom: '10px', marginLeft: '4px' }}>
                        <div style={{
                            fontFamily: 'var(--font-ui)', fontSize: '11px',
                            color: 'var(--text-muted)', fontWeight: 300,
                        }}>feels like {feelsRounded}°</div>
                    </div>
                </div>

                {/* Stats row */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '8px',
                }}>
                    {[
                        { icon: '💧', label: 'Humidity', value: `${data.humidity_pct}%` },
                        { icon: '💨', label: 'Wind', value: `${data.wind_kmh} km/h` },
                        { icon: '👁', label: 'Visibility', value: `${data.visibility_km} km` },
                    ].map(stat => (
                        <div key={stat.label} style={{
                            padding: '8px 10px', borderRadius: '10px',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '14px', marginBottom: '3px' }}>{stat.icon}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {stat.value}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '1px' }}>
                                {stat.label}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ── Calculator Card ───────────────────────────────────────────────────────────

function CalculatorCard({ data, onClose }: { data: CalcData; onClose: () => void }) {
    const isLargeResult = data.formatted.length > 8;

    return (
        <div style={{
            position: 'relative',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, rgba(157,123,234,0.12), rgba(100,80,180,0.06))',
            border: '1px solid rgba(157,123,234,0.25)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            overflow: 'hidden',
            boxShadow: '0 8px 40px rgba(0,0,0,0.25), 0 0 0 1px rgba(157,123,234,0.10)',
        }}>
            {/* Inner glow */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
                background: 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(157,123,234,0.10), transparent)',
                pointerEvents: 'none',
            }} />

            {/* Close */}
            <button
                onClick={onClose}
                style={{
                    position: 'absolute', top: '12px', right: '12px',
                    width: '24px', height: '24px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', lineHeight: 1, zIndex: 2,
                    transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.14)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                }}
                onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                }}
            >✕</button>

            <div style={{ padding: '20px 20px 18px', position: 'relative', zIndex: 1 }}>
                {/* Header */}
                <div style={{ marginBottom: '14px' }}>
                    <div style={{
                        fontFamily: 'var(--font-mono)', fontSize: '9px',
                        color: 'rgba(157,123,234,0.8)', letterSpacing: '0.12em',
                        textTransform: 'uppercase', marginBottom: '3px',
                    }}>CALCULATION</div>
                </div>

                {/* Expression display */}
                <div style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'rgba(0,0,0,0.18)',
                    border: '1px solid rgba(157,123,234,0.15)',
                    marginBottom: '12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    wordBreak: 'break-all',
                    letterSpacing: '0.02em',
                }}>
                    {data.expression}
                </div>

                {/* Big result */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '14px 16px',
                    borderRadius: '12px',
                    background: 'rgba(157,123,234,0.08)',
                    border: '1px solid rgba(157,123,234,0.18)',
                }}>
                    <span style={{ fontSize: '20px' }}>🟰</span>
                    <span style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: isLargeResult ? '24px' : '36px',
                        fontWeight: 800,
                        letterSpacing: '-0.03em',
                        color: 'var(--text-primary)',
                        wordBreak: 'break-all',
                    }}>{data.formatted}</span>
                </div>
            </div>
        </div>
    );
}

// ── Card Overlay ─────────────────────────────────────────────────────────────
// Renders floating over the voice interface, bottom-left corner

export function CardOverlay() {
    const [activeCard, setActiveCard] = useState<ActiveCard>(null);

    useEffect(() => {
        // Expose a setter so ClientToolHandler can push cards here
        (window as unknown as { __jocastaPushCard: (card: ActiveCard) => void }).__jocastaPushCard = setActiveCard;
        return () => {
            delete (window as unknown as { __jocastaPushCard?: unknown }).__jocastaPushCard;
        };
    }, []);

    return (
        <AnimatePresence mode="wait">
            {activeCard && (
                <motion.div
                    key={activeCard.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.96 }}
                    transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                        position: 'fixed',
                        bottom: '140px',   // above the bottom bar
                        right: '20px',
                        zIndex: 500,
                        width: '300px',
                        maxWidth: 'calc(100vw - 40px)',
                        filter: 'drop-shadow(0 20px 60px rgba(0,0,0,0.5))',
                    }}
                >
                    {activeCard.type === 'weather' && (
                        <WeatherCard
                            data={activeCard.data}
                            onClose={() => setActiveCard(null)}
                        />
                    )}
                    {activeCard.type === 'calculator' && (
                        <CalculatorCard
                            data={activeCard.data}
                            onClose={() => setActiveCard(null)}
                        />
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ── Main handler ─────────────────────────────────────────────────────────────
export function ClientToolHandler({ onSystemMessage }: { onSystemMessage?: (text: string) => void }) {
    const room = useRoomContext();

    const runAction = useCallback((action: string, data: Record<string, unknown>) => {
        switch (action) {

            case 'change_theme': {
                const dark = (data.theme as string) !== 'light';
                applyTheme(dark, { sound: true, toast: true });
                console.info('[Jocasta] theme →', dark ? 'dark' : 'light');
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
                const emoji = w.weather_emoji || '🌡';
                onSystemMessage?.(`${emoji} Weather in ${w.city}: ${Math.round(w.temperature_c)}°C, ${w.description} (feels like ${Math.round(w.feels_like_c)}°C). 💧${w.humidity_pct}% 💨${w.wind_kmh}km/h`);
                playSound('card_appear');
                break;
            }

            case 'calculator_card': {
                const c = data as unknown as CalcData;
                onSystemMessage?.(`🧮 ${c.expression} = ${c.formatted}`);
                playSound('card_appear');
                break;
            }

            case 'open_url': {
                const url = data.url as string;
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
                break;
            }

            case 'play_sound': {
                const soundName = (data.sound as string) ?? 'notification';
                playSound(soundName);
                break;
            }

            default:
                console.warn('[ClientToolHandler] unknown action:', action);
        }
    }, [onSystemMessage]);

    useEffect(() => {
        if (!room) return;

        const onData = (
            payload: Uint8Array,
            _participant: unknown,
            _kind: unknown,
            topic?: string,
        ) => {
            if (topic !== 'client-tool') return;
            let msg: ClientToolMsg;
            try {
                msg = JSON.parse(new TextDecoder().decode(payload));
            } catch {
                return;
            }
            if (msg.type === 'client_tool') {
                runAction(msg.action, msg.data ?? {});
            }
        };

        room.on(RoomEvent.DataReceived, onData);
        return () => { room.off(RoomEvent.DataReceived, onData); };
    }, [room, runAction]);

    return null;
}