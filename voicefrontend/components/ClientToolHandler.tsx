// components/ClientToolHandler.tsx
//
// Listens for data messages on topic="client-tool" from the Python agent
// and executes them in the browser.
//
// Handles:
//   change_theme      → sets data-theme attribute + class on <html>
//   show_notification → fires a browser notification (toast fallback)
//   open_url          → opens a URL in a new tab
//   play_sound        → plays a synthesized sound effect via Web Audio API

'use client';

import { useEffect, useCallback, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

interface ClientToolMsg {
    type: 'client_tool';
    action: string;
    data: Record<string, unknown>;
}

// ── Web Audio sound synthesizer ─────────────────────────────────────────────
// No external files needed — pure Web Audio API

function createAudioContext(): AudioContext | null {
    try {
        return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch {
        return null;
    }
}

const soundLibrary: Record<string, (ctx: AudioContext) => void> = {
    // Session start: ascending chime
    session_start: (ctx) => {
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            const t = ctx.currentTime + i * 0.12;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t);
            osc.stop(t + 0.55);
        });
    },

    // Notification: soft double ping
    notification: (ctx) => {
        [880, 1100].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.15;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.14, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            osc.start(t);
            osc.stop(t + 0.45);
        });
    },

    // Success: positive chime
    success: (ctx) => {
        [698.46, 880, 1046.5].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.value = freq;
            const t = ctx.currentTime + i * 0.1;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.15, t + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            osc.start(t);
            osc.stop(t + 0.65);
        });
    },

    // Error: descending tone
    error: (ctx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.45);
    },

    // Click: subtle UI feedback
    click: (ctx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 1200;
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
    },

    // Thinking: subtle processing hum
    thinking: (ctx) => {
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const gain = ctx.createGain();
        osc.connect(gain);
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = 440;
        lfo.type = 'sine';
        lfo.frequency.value = 4;
        lfoGain.gain.value = 30;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.06, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.06, ctx.currentTime + 0.5);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.7);
        osc.start(ctx.currentTime);
        lfo.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.75);
        lfo.stop(ctx.currentTime + 0.75);
    },
};

export function playSound(soundName: string) {
    const ctx = createAudioContext();
    if (!ctx) return;
    const fn = soundLibrary[soundName] ?? soundLibrary['notification'];
    fn(ctx);
}

// ── Toast notification state ────────────────────────────────────────────────
interface Toast {
    id: string;
    title: string;
    message: string;
}

let toastSetter: ((fn: (prev: Toast[]) => Toast[]) => void) | null = null;

function showToast(title: string, message: string) {
    if (!toastSetter) return;
    const id = `toast-${Date.now()}`;
    toastSetter(prev => [...prev, { id, title, message }]);
    setTimeout(() => {
        toastSetter?.(prev => prev.filter(t => t.id !== id));
    }, 4500);
}

// ── Toast Renderer ───────────────────────────────────────────────────────────
export function ToastContainer() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    toastSetter = setToasts;

    return (
        <div style={{
            position: 'fixed',
            top: '72px',
            right: '20px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            pointerEvents: 'none',
        }}>
            {toasts.map(toast => (
                <div
                    key={toast.id}
                    style={{
                        padding: '12px 16px',
                        borderRadius: '12px',
                        background: 'rgba(16,16,21,0.95)',
                        border: '1px solid var(--border-mid)',
                        backdropFilter: 'blur(20px)',
                        WebkitBackdropFilter: 'blur(20px)',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        minWidth: '240px',
                        maxWidth: '320px',
                        animation: 'toast-in 0.3s cubic-bezier(0.16,1,0.3,1) forwards',
                        pointerEvents: 'auto',
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start',
                    }}
                >
                    <div style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: 'var(--gold)',
                        boxShadow: '0 0 8px var(--gold-glow)',
                        marginTop: '4px',
                        flexShrink: 0,
                    }} />
                    <div>
                        <div style={{
                            fontFamily: 'var(--font-display)',
                            fontSize: '13px',
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            letterSpacing: '-0.01em',
                        }}>
                            {toast.title}
                        </div>
                        {toast.message && (
                            <div style={{
                                fontFamily: 'var(--font-ui)',
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                marginTop: '2px',
                            }}>
                                {toast.message}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Main handler ─────────────────────────────────────────────────────────────
export function ClientToolHandler() {
    const room = useRoomContext();

    const runAction = useCallback((action: string, data: Record<string, unknown>) => {
        switch (action) {

            case 'change_theme': {
                const theme = (data.theme as string) === 'light' ? 'light' : 'dark';
                const html = document.documentElement;
                if (theme === 'light') {
                    html.setAttribute('data-theme', 'light');
                    html.classList.remove('dark');
                    html.classList.add('light');
                } else {
                    html.removeAttribute('data-theme');
                    html.classList.remove('light');
                    html.classList.add('dark');
                }
                localStorage.setItem('jocasta-theme', theme);
                console.info('[Jocasta] theme →', theme);
                break;
            }

            case 'show_notification': {
                const title = (data.title as string) ?? 'Jocasta';
                const message = (data.message as string) ?? '';
                showToast(title, message);
                playSound('notification');
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification(title, { body: message });
                }
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
    }, []);

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

    return <ToastContainer />;
}