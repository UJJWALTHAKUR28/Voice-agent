// app/api/token/route.ts
//
// Generates a LiveKit JWT that:
//   1. Lets the browser join the room (publish audio + subscribe)
//   2. Attaches RoomAgentDispatch so LiveKit dispatches the Python agent
//      automatically the moment the browser participant joins the room
//
// CRITICAL: agent_name here MUST exactly match what the Python worker
// registered with. Check backend logs:
//   "registered worker" → {"agent_name": "voice-agent", ...}
//
// livekit-server-sdk v2.x pattern — roomConfig attached via at.roomConfig

import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

// ── Must match voiceBackend/main.py WorkerOptions(agent_name=...) ──────────
const AGENT_NAME = 'voice-agent';

// ── One room for the whole app ─────────────────────────────────────────────
// Each user joins as a different participant identity.
// The agent is dispatched once per room — it handles all participants.
const ROOM_NAME = 'aria-room';

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

    // Each browser tab gets a unique participant identity
    const identity = req.nextUrl.searchParams.get('identity')
        ?? `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const at = new AccessToken(apiKey, apiSecret, {
        identity,
        ttl: '2h',
    });

    // Grant room permissions
    at.addGrant({
        roomJoin: true,
        room: ROOM_NAME,
        canPublish: true,       // browser can send mic audio
        canSubscribe: true,       // browser can hear the agent
        canPublishData: true,       // browser can send DataPackets (text input)
    });

    // ── CRITICAL: attach agent dispatch config to the token ────────────────
    // This is what tells LiveKit Cloud to dispatch the Python agent when
    // this participant joins. Without this, the agent stays idle forever.
    at.roomConfig = new RoomConfiguration({
        agents: [
            new RoomAgentDispatch({
                agentName: AGENT_NAME,
                // metadata is passed to the agent's JobContext.job.metadata
                // useful for passing user context to the agent later
                metadata: JSON.stringify({ identity }),
            }),
        ],
    });

    const token = await at.toJwt();

    // ── Debug: log what we're sending ──────────────────────────────────────
    // Decode and log the payload in dev so you can verify dispatch is present
    if (process.env.NODE_ENV === 'development') {
        try {
            const payload = JSON.parse(
                Buffer.from(token.split('.')[1], 'base64').toString()
            );
            const hasDispatch = !!payload?.video?.roomConfig?.agents?.length;
            console.log('[token] generated for', identity, '| dispatch:', hasDispatch, '| room:', ROOM_NAME);
            if (!hasDispatch) {
                console.warn('[token] WARNING: RoomAgentDispatch not in token! Agent will NOT be dispatched.');
            }
        } catch {
            // ignore decode errors
        }
    }

    return NextResponse.json({
        token,
        url: wsUrl,
        room: ROOM_NAME,
    });
}