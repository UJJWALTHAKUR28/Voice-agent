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


export async function GET(req: NextRequest) {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
    const ROOM_NAME = req.nextUrl.searchParams.get('room')
        ?? `jocasta-${Date.now()}`;;
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

    // Attach agent dispatch
    at.roomConfig = new RoomConfiguration({
        agents: [
            new RoomAgentDispatch({
                agentName: AGENT_NAME,
                metadata: JSON.stringify({ identity }),
            }),
        ],
    });

    // DEBUG BEFORE JWT CREATION
    console.log('\n========== BEFORE JWT ==========');
    console.log('Room:', ROOM_NAME);
    console.log('Identity:', identity);
    console.log('Agent Name:', AGENT_NAME);
    console.dir(at.roomConfig, { depth: null });
    console.log('================================\n');

    const token = await at.toJwt();

    // DEBUG AFTER JWT CREATION
    if (process.env.NODE_ENV === 'development') {
        try {
            const payload = JSON.parse(
                Buffer.from(token.split('.')[1], 'base64').toString()
            );

            console.log('\n========== JWT PAYLOAD ==========');
            console.log(JSON.stringify(payload, null, 2));
            console.log('=================================\n');

            console.log('\n========== ROOM CONFIG ==========');
            console.log(
                JSON.stringify(payload?.video?.roomConfig ?? null, null, 2)
            );
            console.log('=================================\n');

            const hasDispatch =
                !!payload?.video?.roomConfig?.agents?.length;

            console.log(
                '[token] identity=%s | room=%s | dispatch=%s',
                identity,
                ROOM_NAME,
                hasDispatch,
            );

            if (hasDispatch) {
                console.log(
                    '[token] agents:',
                    JSON.stringify(
                        payload.video.roomConfig.agents,
                        null,
                        2
                    )
                );
            } else {
                console.warn(
                    '[token] WARNING: RoomAgentDispatch missing from JWT!'
                );
            }
        } catch (err) {
            console.error('[token] JWT decode failed:', err);
        }
    }

    return NextResponse.json({ token, url: wsUrl, room: ROOM_NAME });
}