// app/api/token/route.ts
//
// Generates a LiveKit JWT that:
//   1. Lets the browser join the room (publish audio + subscribe)
//   2. Attaches RoomAgentDispatch so LiveKit dispatches the Python agent
//
// CRITICAL: ROOM_NAME must EXACTLY match what the backend uses.
// Backend logs show: "room": "jocasta-room"  ← must match here
//
// CRITICAL: AGENT_NAME must EXACTLY match WorkerOptions(agent_name=...) in main.py
// Backend logs show: "agent_name": "voice-agent"  ← must match here

import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

// ── Must match voiceBackend/main.py agent_name ────────────────────────────
const AGENT_NAME = 'voice-agent';

// ── Must match what the backend room is named ─────────────────────────────
// Backend logs show room="jocasta-room" — was incorrectly set to "aria-room"
const ROOM_NAME = 'jocasta-room';

export async function GET(req: NextRequest) {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    if (!apiKey || !apiSecret || !wsUrl) {
        console.error('[token] Missing env vars:', {
            hasKey: !!apiKey,
            hasSecret: !!apiSecret,
            hasUrl: !!wsUrl,
        });
        return NextResponse.json(
            { error: 'LiveKit env vars not configured. Check .env.local.' },
            { status: 500 },
        );
    }

    const identity = req.nextUrl.searchParams.get('identity')
        ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const at = new AccessToken(apiKey, apiSecret, {
        identity,
        ttl: '2h',
    });

    at.addGrant({
        roomJoin: true,
        room: ROOM_NAME,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });

    // Attach agent dispatch — this is what triggers the Python agent
    at.roomConfig = new RoomConfiguration({
        agents: [
            new RoomAgentDispatch({
                agentName: AGENT_NAME,
                metadata: JSON.stringify({ identity }),
            }),
        ],
    });

    const token = await at.toJwt();

    // Debug log in dev
    if (process.env.NODE_ENV === 'development') {
        try {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            const hasDispatch = !!payload?.video?.roomConfig?.agents?.length;
            console.log(
                '[token] identity=%s | room=%s | dispatch=%s',
                identity, ROOM_NAME, hasDispatch,
            );
            if (!hasDispatch) {
                console.warn('[token] WARNING: RoomAgentDispatch missing from token!');
            }
        } catch { /* ignore */ }
    }

    return NextResponse.json({ token, url: wsUrl, room: ROOM_NAME });
}