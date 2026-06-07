'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { registerThemeToastFn } from '@/utils/theme';

export interface ToastItem {
    id: string;
    title: string;
    message?: string;
    variant?: 'dark' | 'light' | 'info' | 'success' | 'error';
    duration?: number;
}
let _pushToast: ((t: Omit<ToastItem, 'id'>) => void) | null = null;

export function pushToast(t: Omit<ToastItem, 'id'>) {
    _pushToast?.(t);
}
function MoonIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M13.5 10A5.5 5.5 0 016.5 3a6 6 0 100 10 5.5 5.5 0 007-3z"
                fill="currentColor" />
        </svg>
    );
}

function SunIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" fill="currentColor" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"
                stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

function InfoIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 7v5M8 5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}

function SuccessIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function ErrorIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    );
}
const VARIANT_STYLES: Record<NonNullable<ToastItem['variant']>, {
    icon: React.ReactNode;
    iconColor: string;
    accent: string;
    border: string;
    bg: string;
}> = {
    dark: {
        icon: <MoonIcon />,
        iconColor: '#c8922a',
        accent: 'rgba(200,146,42,0.9)',
        border: 'rgba(200,146,42,0.25)',
        bg: 'linear-gradient(135deg, rgba(200,146,42,0.08) 0%, rgba(200,146,42,0.03) 100%)',
    },
    light: {
        icon: <SunIcon />,
        iconColor: '#e8ac44',
        accent: 'rgba(232,172,68,0.95)',
        border: 'rgba(232,172,68,0.3)',
        bg: 'linear-gradient(135deg, rgba(232,172,68,0.1) 0%, rgba(232,172,68,0.04) 100%)',
    },
    info: {
        icon: <InfoIcon />,
        iconColor: '#5ba4f5',
        accent: 'rgba(91,164,245,0.9)',
        border: 'rgba(91,164,245,0.25)',
        bg: 'linear-gradient(135deg, rgba(91,164,245,0.08) 0%, rgba(91,164,245,0.03) 100%)',
    },
    success: {
        icon: <SuccessIcon />,
        iconColor: '#2dd4a0',
        accent: 'rgba(45,212,160,0.9)',
        border: 'rgba(45,212,160,0.25)',
        bg: 'linear-gradient(135deg, rgba(45,212,160,0.08) 0%, rgba(45,212,160,0.03) 100%)',
    },
    error: {
        icon: <ErrorIcon />,
        iconColor: '#f87171',
        accent: 'rgba(248,113,113,0.9)',
        border: 'rgba(248,113,113,0.25)',
        bg: 'linear-gradient(135deg, rgba(248,113,113,0.08) 0%, rgba(248,113,113,0.03) 100%)',
    },
};
function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
    const variant = item.variant ?? 'info';
    const style = VARIANT_STYLES[variant];
    const [exiting, setExiting] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const dismiss = useCallback(() => {
        setExiting(true);
        setTimeout(() => onDismiss(item.id), 340);
    }, [item.id, onDismiss]);

    useEffect(() => {
        const dur = item.duration ?? 3800;
        timerRef.current = setTimeout(dismiss, dur);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [dismiss, item.duration]);

    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px 16px',
                borderRadius: '14px',
                background: 'var(--bg-raised)',
                border: `1px solid ${style.border}`,
                boxShadow: `
                    0 4px 24px rgba(0,0,0,0.18),
                    0 1px 4px rgba(0,0,0,0.10),
                    inset 0 1px 0 rgba(255,255,255,0.06)
                `,
                minWidth: '260px',
                maxWidth: '340px',
                cursor: 'pointer',
                overflow: 'hidden',
                animation: exiting
                    ? 'toast-exit 0.34s cubic-bezier(0.4,0,1,1) forwards'
                    : 'toast-enter 0.38s cubic-bezier(0.16,1,0.3,1) forwards',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
            }}
            onClick={dismiss}
        >
            {/* Gradient wash */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: style.bg,
                borderRadius: 'inherit',
                pointerEvents: 'none',
            }} />

            {/* Left accent bar */}
            <div style={{
                position: 'absolute',
                left: 0,
                top: '12px',
                bottom: '12px',
                width: '3px',
                borderRadius: '0 3px 3px 0',
                background: style.accent,
            }} />

            {/* Icon */}
            <div style={{
                color: style.iconColor,
                flexShrink: 0,
                marginTop: '1px',
                position: 'relative',
                zIndex: 1,
            }}>
                {style.icon}
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
                <div style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.01em',
                    lineHeight: 1.3,
                }}>
                    {item.title}
                </div>
                {item.message && (
                    <div style={{
                        fontFamily: 'var(--font-ui)',
                        fontSize: '12px',
                        color: 'var(--text-secondary)',
                        marginTop: '3px',
                        lineHeight: 1.45,
                    }}>
                        {item.message}
                    </div>
                )}
            </div>

            {/* Progress bar */}
            <div style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '2px',
                background: `linear-gradient(90deg, ${style.accent}, transparent)`,
                animation: `toast-progress ${item.duration ?? 3800}ms linear forwards`,
                transformOrigin: 'left',
                borderRadius: '0 0 14px 14px',
            }} />
        </div>
    );
}
export function ThemeToastContainer() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const push = useCallback((t: Omit<ToastItem, 'id'>) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        setToasts(prev => [...prev.slice(-4), { ...t, id }]); // max 5 visible
    }, []);

    const dismiss = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    useEffect(() => {
        _pushToast = push;
        return () => { _pushToast = null; };
    }, [push]);
    useEffect(() => {
        registerThemeToastFn((title, message, variant) => {
            push({ title, message, variant: variant ?? 'info' });
        });
    }, [push]);
    return (
        <>
            <style>{`
                @keyframes toast-enter {
                    from { opacity: 0; transform: translateX(calc(100% + 20px)) scale(0.92); }
                    to   { opacity: 1; transform: translateX(0) scale(1); }
                }
                @keyframes toast-exit {
                    from { opacity: 1; transform: translateX(0) scale(1); }
                    to   { opacity: 0; transform: translateX(calc(100% + 20px)) scale(0.9); }
                }
                @keyframes toast-progress {
                    from { transform: scaleX(1); }
                    to   { transform: scaleX(0); }
                }
            `}</style>

            <div
                aria-live="polite"
                style={{
                    position: 'fixed',
                    top: '68px',
                    right: '20px',
                    zIndex: 99999,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                    pointerEvents: 'none',
                }}
            >
                {toasts.map(t => (
                    <div key={t.id} style={{ pointerEvents: 'auto' }}>
                        <Toast item={t} onDismiss={dismiss} />
                    </div>
                ))}
            </div>
        </>
    );
}