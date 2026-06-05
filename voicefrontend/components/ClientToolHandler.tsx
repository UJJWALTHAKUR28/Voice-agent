// components/ClientToolHandler.tsx
//
// Listens for data messages on topic="client-tool" from the Python agent
// and executes them in the browser.
//
// Currently handles:
//   change_theme      → sets data-theme attribute + class on <html>
//   show_notification → fires a browser notification (toast fallback via console)
//   open_url          → opens a URL in a new tab

'use client';

import { useEffect, useCallback } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

interface ClientToolMsg {
    type: 'client_tool';
    action: string;
    data: Record<string, unknown>;
}

export function ClientToolHandler() {
    const room = useRoomContext();

    const runAction = useCallback((action: string, data: Record<string, unknown>) => {
        switch (action) {

            case 'change_theme': {
                const theme = (data.theme as string) === 'light' ? 'light' : 'dark';
                const html = document.documentElement;
                html.setAttribute('data-theme', theme);
                html.classList.remove('dark', 'light');
                html.classList.add(theme);
                console.info('[Aria] theme →', theme);
                break;
            }

            case 'show_notification': {
                const title = (data.title as string) ?? 'Aria';
                const message = (data.message as string) ?? '';
                // Wire to your toast library here (sonner, react-hot-toast, etc.)
                // For now: browser Notification API + console fallback
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification(title, { body: message });
                } else {
                    console.info(`[Aria] ${title}: ${message}`);
                }
                break;
            }

            case 'open_url': {
                const url = data.url as string;
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
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

    return null;   // pure side effects, no DOM
}