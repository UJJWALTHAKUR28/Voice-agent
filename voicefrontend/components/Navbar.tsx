'use client';

// components/Navbar.tsx
// Premium floating navbar — Iron Man aesthetic
// Uses central theme utility for consistent theme application + toasts + sounds

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { applyTheme, getTheme, toggleTheme } from '@/utils/theme';

function ThemeIcon({ isDark }: { isDark: boolean }) {
    return isDark ? (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M3.05 3.05l1.06 1.06M10.89 10.89l1.06 1.06M3.05 11.95l1.06-.71m7.31-7.31.71-.71"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    ) : (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M12.5 9.5A5.5 5.5 0 015.5 2.5a6 6 0 100 10 5.5 5.5 0 007-3z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function HomeIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M1.5 6.5L7.5 1.5l6 5V13a.5.5 0 01-.5.5H9.5v-3h-4v3H2a.5.5 0 01-.5-.5V6.5z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function ChatIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M2 3.5A1.5 1.5 0 013.5 2h8A1.5 1.5 0 0113 3.5v6A1.5 1.5 0 0111.5 11H9l-2 2.5L5 11H3.5A1.5 1.5 0 012 9.5v-6z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function SettingsIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <circle cx="7.5" cy="7.5" r="1.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M7.5 1.5v1m0 10v1m-4.5-5.5h-1m10 0h1M3.34 3.34l.71.71m7.31 7.31l.71.71M3.34 11.66l.71-.71m7.31-7.31l.71-.71"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    );
}

export function Navbar() {
    const pathname = usePathname();
    const [isDark, setIsDark] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        setMounted(true);
        const dark = getTheme();
        setIsDark(dark);
        // Apply without sound/toast on mount
        applyTheme(dark);
    }, []);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 10);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Listen for theme changes from other sources (e.g. ClientToolHandler)
    useEffect(() => {
        const observer = new MutationObserver(() => {
            const dark = !document.documentElement.hasAttribute('data-theme');
            setIsDark(dark);
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme', 'class'],
        });
        return () => observer.disconnect();
    }, []);

    function handleToggleTheme() {
        const next = toggleTheme(); // handles sound + toast
        setIsDark(next);
    }

    if (!mounted) return null;

    const navLinks = [
        { href: '/', label: 'Home', icon: <HomeIcon /> },
        { href: '/chat', label: 'Interface', icon: <ChatIcon /> },
        { href: '/settings', label: 'Settings', icon: <SettingsIcon /> },
    ];

    return (
        <nav
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 24px',
                height: '56px',
                background: scrolled
                    ? 'var(--nav-bg)'
                    : isDark
                        ? 'rgba(6,6,8,0.6)'
                        : 'rgba(248,246,241,0.7)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                borderBottom: '1px solid var(--nav-border)',
                transition: 'background 0.35s ease, border-color 0.35s ease',
            }}
        >
            {/* Left: Logo */}
            <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* Gold J avatar */}
                <div style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: '13px',
                    color: '#0c0a06',
                    flexShrink: 0,
                    boxShadow: '0 0 0 1px rgba(200,146,42,0.3), 0 0 12px rgba(200,146,42,0.2)',
                }}>
                    J
                </div>
                <span style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '14px',
                    letterSpacing: '-0.02em',
                    color: 'var(--text-primary)',
                    transition: 'color 0.3s ease',
                }}>
                    Jocasta
                </span>
                {/* Online status dot */}
                <span style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '2px 8px',
                    borderRadius: '100px',
                    border: '1px solid rgba(45,212,160,0.25)',
                    background: 'rgba(45,212,160,0.07)',
                }}>
                    <span style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: 'var(--c-listen)',
                        boxShadow: '0 0 6px rgba(45,212,160,0.7)',
                        animation: 'pulse-soft 2s ease infinite',
                    }} />
                    <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: 'var(--c-listen)',
                        letterSpacing: '0.08em',
                    }}>
                        ONLINE
                    </span>
                </span>
            </Link>

            {/* Centre: Nav links */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                padding: '4px',
                borderRadius: '12px',
                border: '1px solid var(--border-dim)',
                background: 'var(--bg-glass)',
                backdropFilter: 'blur(12px)',
                transition: 'background 0.3s ease, border-color 0.3s ease',
            }}>
                {navLinks.map(link => {
                    const isActive = pathname === link.href;
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 12px',
                                borderRadius: '8px',
                                background: isActive ? 'var(--gold-dim)' : 'transparent',
                                border: isActive ? '1px solid rgba(200,146,42,0.25)' : '1px solid transparent',
                                color: isActive ? 'var(--gold)' : 'var(--text-secondary)',
                                textDecoration: 'none',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '11px',
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                transition: 'all 0.2s ease',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => {
                                if (!isActive) {
                                    (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-glass-hover)';
                                }
                            }}
                            onMouseLeave={e => {
                                if (!isActive) {
                                    (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                                }
                            }}
                        >
                            {link.icon}
                            {link.label}
                        </Link>
                    );
                })}
            </div>

            {/* Right: Theme toggle */}
            <button
                onClick={handleToggleTheme}
                title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '7px 14px',
                    borderRadius: '100px',
                    border: '1px solid var(--border-mid)',
                    background: 'var(--bg-glass)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    letterSpacing: '0.06em',
                    transition: 'all 0.2s ease',
                    backdropFilter: 'blur(8px)',
                }}
                onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--gold)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,146,42,0.4)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--gold-dim)';
                }}
                onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-mid)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-glass)';
                }}
            >
                <ThemeIcon isDark={isDark} />
                {isDark ? 'Light' : 'Dark'}
            </button>
        </nav>
    );
}