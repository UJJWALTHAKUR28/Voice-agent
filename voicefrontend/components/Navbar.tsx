'use client';

// components/Navbar.tsx — Premium Jocasta Navbar
// Clean, frameless design — no hard box boundaries, consistent hover states

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { applyTheme, getTheme, toggleTheme } from '@/utils/theme';

function ThemeIcon({ isDark }: { isDark: boolean }) {
    return isDark ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="2.3" stroke="currentColor" strokeWidth="1.25" />
            <path d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.75 2.75l1 1M10.25 10.25l1 1M2.75 11.25l1-1M10.25 3.75l1-1"
                stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M11.5 8.8A5 5 0 014.9 2.2a5.5 5.5 0 100 9.6A5 5 0 0011.5 8.8z"
                stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

const NAV_LINKS = [
    {
        href: '/', label: 'Home',
        icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1 5.8L6.5 1.5l5.5 4.3V12a.5.5 0 01-.5.5H8.5v-3h-4v3H1.5A.5.5 0 011 12V5.8z" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" /></svg>
    },
    {
        href: '/chat', label: 'Interface',
        icon: <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M1.5 3A1.5 1.5 0 013 1.5h7A1.5 1.5 0 0111.5 3v5A1.5 1.5 0 0110 9.5H7.5L6.5 11 5.5 9.5H3A1.5 1.5 0 011.5 8V3z" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" /></svg>
    },
];

export function Navbar() {
    const pathname = usePathname();
    const [isDark, setIsDark] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        setMounted(true);
        const dark = getTheme();
        setIsDark(dark);
        applyTheme(dark);
    }, []);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 12);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDark(!document.documentElement.hasAttribute('data-theme'));
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme', 'class'],
        });
        return () => observer.disconnect();
    }, []);

    function handleToggleTheme() {
        setIsDark(toggleTheme());
    }

    if (!mounted) return null;

    return (
        <nav style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
            height: '56px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 20px',
            background: scrolled
                ? 'var(--nav-bg)'
                : 'transparent',
            backdropFilter: scrolled ? 'blur(24px)' : 'blur(0px)',
            WebkitBackdropFilter: scrolled ? 'blur(24px)' : 'blur(0px)',
            borderBottom: scrolled ? '1px solid var(--border-dim)' : '1px solid transparent',
            transition: 'background 0.3s ease, border-color 0.3s ease, backdrop-filter 0.3s ease',
        }}>
            {/* ── Logo ─────────────────────────────────────────────── */}
            <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                    width: '26px', height: '26px', borderRadius: '50%',
                    background: 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-display)', fontWeight: 800,
                    fontSize: '12px', color: '#0c0a06', flexShrink: 0,
                    boxShadow: '0 0 0 1px rgba(200,146,42,0.25), 0 0 10px rgba(200,146,42,0.15)',
                }}>J</div>
                <span style={{
                    fontFamily: 'var(--font-display)', fontWeight: 700,
                    fontSize: '14px', letterSpacing: '-0.02em',
                    color: 'var(--text-primary)',
                }}>Jocasta</span>
                <span style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '3px 9px', borderRadius: '100px',
                    border: '1px solid rgba(45,212,160,0.2)',
                    background: 'rgba(45,212,160,0.06)',
                }}>
                    <span style={{
                        width: '5px', height: '5px', borderRadius: '50%',
                        background: 'var(--c-listen)',
                        boxShadow: '0 0 5px rgba(45,212,160,0.7)',
                        animation: 'pulse-soft 2s ease infinite',
                    }} />
                    <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: '9px',
                        color: 'var(--c-listen)', letterSpacing: '0.1em',
                    }}>ONLINE</span>
                </span>
            </Link>

            {/* ── Nav links — pill container ───────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '2px',
                padding: '3px',
                borderRadius: '11px',
                border: '1px solid var(--border-dim)',
                background: 'var(--bg-glass)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
            }}>
                {NAV_LINKS.map(link => {
                    const active = pathname === link.href;
                    return (
                        <Link
                            key={link.href}
                            href={link.href}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                padding: '5px 11px',
                                borderRadius: '8px',
                                background: active ? 'var(--gold-dim)' : 'transparent',
                                border: active
                                    ? '1px solid rgba(200,146,42,0.22)'
                                    : '1px solid transparent',
                                color: active ? 'var(--gold)' : 'var(--text-muted)',
                                textDecoration: 'none',
                                fontFamily: 'var(--font-mono)', fontSize: '10px',
                                letterSpacing: '0.07em', textTransform: 'uppercase',
                                transition: 'all 0.18s ease',
                                whiteSpace: 'nowrap',
                            }}
                            onMouseEnter={e => {
                                if (!active) {
                                    (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
                                    (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
                                }
                            }}
                            onMouseLeave={e => {
                                if (!active) {
                                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
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

            {/* ── Theme toggle ────────────────────────────────────────── */}
            <button
                onClick={handleToggleTheme}
                title={isDark ? 'Light mode' : 'Dark mode'}
                style={{
                    display: 'flex', alignItems: 'center', gap: '7px',
                    padding: '6px 14px',
                    borderRadius: '100px',
                    border: '1px solid var(--border-dim)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)', fontSize: '10px',
                    letterSpacing: '0.07em', textTransform: 'uppercase',
                    transition: 'all 0.18s ease',
                }}
                onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--gold)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,146,42,0.35)';
                    (e.currentTarget as HTMLElement).style.background = 'var(--gold-dim)';
                }}
                onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
                    (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-dim)';
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
            >
                <ThemeIcon isDark={isDark} />
                {isDark ? 'Light' : 'Dark'}
            </button>
        </nav>
    );
}