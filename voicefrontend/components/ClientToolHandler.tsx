'use client';

// components/ClientToolHandler.tsx
//
// Listens for data messages on topic="client-tool" from the Python agent.
// Now uses: central theme utility (utils/theme.ts) + ThemeToast push API.

import { useEffect, useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { applyTheme } from '@/utils/theme';
import { pushToast } from './Themetoast';

interface ClientToolMsg {
    type: 'client_tool';
    action: string;
    data: Record<string, unknown>;
}

// ── Web Audio sound synthesizer ─────────────────────────────────────────────

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

// ── Main handler ─────────────────────────────────────────────────────────────
export function ClientToolHandler() {
    const room = useRoomContext();

    const runAction = useCallback((action: string, data: Record<string, unknown>) => {
        switch (action) {

            case 'change_theme': {
                // Use central theme utility — plays sound + shows toast automatically
                const dark = (data.theme as string) !== 'light';
                applyTheme(dark, { sound: true, toast: true });
                console.info('[Jocasta] theme →', dark ? 'dark' : 'light');
                break;
            }

            case 'show_notification': {
                const title = (data.title as string) ?? 'Jocasta';
                const message = (data.message as string) ?? '';
                pushToast({ title, message, variant: 'info' });
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

    // No longer renders ToastContainer — that's in layout.tsx via ThemeToastContainer
    return null;
}