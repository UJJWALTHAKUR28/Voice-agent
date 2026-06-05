// app/page.tsx
'use client';

import { VoiceAgent } from '@/components/VoiceAgent';

export default function Page() {
    return (
        <main style={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-base)',
            padding: '20px',
        }}>
            {/* Subtle background grain */}
            <div style={{
                position: 'fixed',
                inset: 0,
                background: `
                    radial-gradient(ellipse 60% 50% at 50% 0%, rgba(240,160,80,0.06) 0%, transparent 70%),
                    radial-gradient(ellipse 40% 30% at 80% 80%, rgba(96,165,250,0.04) 0%, transparent 60%)
                `,
                pointerEvents: 'none',
                zIndex: 0,
            }} />

            {/* Chat window */}
            <div style={{
                position: 'relative',
                zIndex: 1,
                width: '100%',
                maxWidth: '480px',
                height: '100%',
                maxHeight: '760px',
            }}>
                <VoiceAgent />
            </div>
        </main>
    );
}