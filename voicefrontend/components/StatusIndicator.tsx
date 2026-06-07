'use client';
import type { AgentState } from '../hooks/useAgentEvents';

const STATE_CONFIG: Record<AgentState, { label: string; color: string; cssVar: string }> = {
    initializing: { label: 'Starting up', color: '#f59e0b', cssVar: '--state-idle' },
    idle: { label: 'Ready', color: '#55556a', cssVar: '--state-idle' },
    listening: { label: 'Listening', color: '#34d399', cssVar: '--state-listening' },
    thinking: { label: 'Thinking', color: '#a78bfa', cssVar: '--state-thinking' },
    speaking: { label: 'Speaking', color: '#60a5fa', cssVar: '--state-speaking' },
};

interface StatusIndicatorProps {
    state: AgentState;
}

export function StatusIndicator({ state }: StatusIndicatorProps) {
    const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.idle;

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 14px',
            borderRadius: '9999px',
            background: 'var(--bg-glass)',
            border: '1px solid var(--border)',
            userSelect: 'none',
        }}>
            {/* State dot */}
            <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: cfg.color,
                flexShrink: 0,
                boxShadow: state === 'listening' || state === 'speaking'
                    ? `0 0 8px ${cfg.color}80`
                    : 'none',
                animation: state === 'listening'
                    ? 'pulse-ring 1.6s ease infinite'
                    : state === 'thinking'
                        ? 'shimmer 1.2s ease infinite'
                        : 'none',
            }} />

            {/* Label */}
            <span style={{
                fontSize: '11px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 500,
                color: cfg.color,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
            }}>
                {cfg.label}
            </span>
        </div>
    );
}