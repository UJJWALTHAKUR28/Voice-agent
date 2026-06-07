'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, useScroll, useTransform } from 'motion/react';
import { applyTheme, getTheme, toggleTheme } from '@/utils/theme';
function HomeIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <path
                d="M2 7.2L8 2l6 5.2V14a.6.6 0 01-.6.6H10v-3.6H6V14.6H2.6A.6.6 0 012 14V7.2z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
            />
        </svg>
    );
}

function ChatIcon({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <path
                d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v6A1.5 1.5 0 0112.5 11H9l-3 3v-3H3.5A1.5 1.5 0 012 9.5v-6z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
            />
            <path d="M5 5.5h6M5 7.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );
}

function SunIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.3" />
            <path
                d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"
            />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
            <path
                d="M13.5 10.2A6 6 0 016 2.5a6.5 6.5 0 100 11A6 6 0 0013.5 10.2z"
                stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
            />
        </svg>
    );
}

function MicIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="4" y="1" width="4" height="6" rx="2" fill="currentColor" opacity="0.9" />
            <path d="M2 6a4 4 0 008 0M6 10v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
    );
}
function LiveDot() {
    return (
        <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8, flexShrink: 0 }}>
            {/* Ripple ring */}
            <span style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: 'var(--c-listen)',
                opacity: 0.4,
                animation: 'live-ping 1.8s cubic-bezier(0,0,0.2,1) infinite',
            }} />
            {/* Solid core */}
            <span style={{
                position: 'relative', width: 8, height: 8, borderRadius: '50%',
                background: 'var(--c-listen)',
                boxShadow: '0 0 6px rgba(45,212,160,0.8)',
            }} />
            <style>{`
        @keyframes live-ping {
          75%, 100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
        </span>
    );
}
function JocastaLogo({ isLight }: { isLight: boolean }) {
    const [hovered, setHovered] = useState(false);

    return (
        <Link
            href="/"
            style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
        >
            <motion.div
                animate={{ scale: hovered ? 1.12 : 1, rotate: hovered ? 15 : 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: isLight
                        ? 'linear-gradient(135deg, #2e7d52 0%, #1a5c3a 100%)'
                        : 'radial-gradient(circle at 35% 32%, #f0be5c, #c8922a)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-display)', fontWeight: 800,
                    fontSize: 12, color: isLight ? '#fff' : '#0c0a06',
                    flexShrink: 0,
                    boxShadow: isLight
                        ? '0 0 0 1px rgba(26,92,58,0.30), 0 2px 12px rgba(26,92,58,0.25)'
                        : '0 0 0 1px rgba(200,146,42,0.35), 0 2px 12px rgba(200,146,42,0.22), 0 0 20px rgba(200,146,42,0.10)',
                }}
            >
                J
            </motion.div>

            <motion.span
                animate={{ opacity: hovered ? 1 : 0.88 }}
                transition={{ duration: 0.2 }}
                style={{
                    fontFamily: 'var(--font-display)', fontWeight: 700,
                    fontSize: 15, letterSpacing: '-0.025em',
                    color: 'var(--text-primary)',
                }}
            >
                Jocasta
            </motion.span>

            <motion.div
                animate={{ opacity: hovered ? 1 : 0.85, scale: hovered ? 1.03 : 1 }}
                transition={{ duration: 0.2 }}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 9px 3px 7px', borderRadius: 100,
                    border: '1px solid rgba(45,212,160,0.22)',
                    background: 'rgba(45,212,160,0.07)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <LiveDot />
                <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: 'var(--c-listen)', letterSpacing: '0.12em',
                    lineHeight: 1,
                }}>
                    LIVE
                </span>
            </motion.div>
        </Link>
    );
}

const NAV_LINKS = [
    { href: '/', label: 'Home', Icon: HomeIcon, shortcut: '⌘H' },
    { href: '/chat', label: 'Chat', Icon: ChatIcon, shortcut: '⌘C' },
];

function NavPill({ isLight }: { isLight: boolean }) {
    const pathname = usePathname();
    const [hovered, setHovered] = useState<string | null>(null);
    const pillRef = useRef<HTMLDivElement>(null);

    const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });

    useEffect(() => {
        const container = pillRef.current;
        if (!container) return;
        const activeEl = container.querySelector(`[data-active="true"]`) as HTMLElement | null;
        if (activeEl) {
            setIndicatorStyle({ left: activeEl.offsetLeft, width: activeEl.offsetWidth });
        }
    }, [pathname]);

    return (
        <div
            ref={pillRef}
            style={{
                display: 'flex', alignItems: 'center',
                gap: 2, padding: 4, borderRadius: 14,
                border: isLight
                    ? '1px solid rgba(26,92,58,0.12)'
                    : '1px solid var(--border-dim)',
                background: isLight
                    ? 'rgba(255,255,255,0.72)'
                    : 'var(--bg-glass)',
                backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                position: 'relative',
                boxShadow: isLight
                    ? '0 1px 4px rgba(15,40,20,0.06), inset 0 1px 0 rgba(255,255,255,0.90)'
                    : '0 1px 0 rgba(255,255,255,0.03) inset',
            }}
        >
            <motion.div
                animate={{ left: indicatorStyle.left, width: indicatorStyle.width }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                style={{
                    position: 'absolute', top: 4, bottom: 4,
                    borderRadius: 10,
                    background: isLight
                        ? 'rgba(26,92,58,0.10)'
                        : 'var(--gold-dim)',
                    border: isLight
                        ? '1px solid rgba(26,92,58,0.16)'
                        : '1px solid rgba(200,146,42,0.20)',
                    pointerEvents: 'none', zIndex: 0,
                }}
            />

            {NAV_LINKS.map(({ href, label, Icon, shortcut }) => {
                const active = pathname === href;
                const isHov = hovered === href;

                return (
                    <Link
                        key={href}
                        href={href}
                        data-active={active}
                        onMouseEnter={() => setHovered(href)}
                        onMouseLeave={() => setHovered(null)}
                        title={`${label} ${shortcut}`}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            padding: '6px 13px', borderRadius: 10,
                            textDecoration: 'none', position: 'relative', zIndex: 1,
                            color: active
                                ? isLight ? 'var(--gold)' : 'var(--gold)'
                                : isHov
                                    ? 'var(--text-primary)'
                                    : 'var(--text-muted)',
                            fontFamily: 'var(--font-mono)', fontSize: 10,
                            letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                            transition: 'color 0.18s ease',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        <Icon size={13} />
                        {label}
                    </Link>
                );
            })}
        </div>
    );
}


function ThemeToggle({ isDark, isLight, onToggle }: { isDark: boolean; isLight: boolean; onToggle: () => void }) {
    const [hovered, setHovered] = useState(false);

    return (
        <motion.button
            onClick={onToggle}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            whileTap={{ scale: 0.92 }}
            title={isDark ? 'Switch to light mode (⌘⇧L)' : 'Switch to dark mode (⌘⇧D)'}
            style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 14px', borderRadius: 100,
                border: hovered
                    ? isLight ? '1px solid rgba(26,92,58,0.32)' : '1px solid rgba(200,146,42,0.40)'
                    : isLight ? '1px solid rgba(26,92,58,0.14)' : '1px solid var(--border-dim)',
                background: hovered
                    ? isLight ? 'rgba(26,92,58,0.06)' : 'var(--gold-dim)'
                    : 'transparent',
                color: hovered
                    ? isLight ? 'var(--gold)' : 'var(--gold-bright)'
                    : 'var(--text-muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)', fontSize: 10,
                letterSpacing: '0.08em', textTransform: 'uppercase' as const,
                transition: 'all 0.18s ease',
                outline: 'none',
            }}
        >
            <AnimatePresence mode="wait">
                <motion.span
                    key={isDark ? 'sun' : 'moon'}
                    initial={{ opacity: 0, rotate: -30, scale: 0.6 }}
                    animate={{ opacity: 1, rotate: 0, scale: 1 }}
                    exit={{ opacity: 0, rotate: 30, scale: 0.6 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    style={{ display: 'flex', alignItems: 'center' }}
                >
                    {isDark ? <SunIcon /> : <MoonIcon />}
                </motion.span>
            </AnimatePresence>

            <AnimatePresence mode="wait">
                <motion.span
                    key={isDark ? 'light-label' : 'dark-label'}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 4 }}
                    transition={{ duration: 0.18 }}
                >
                    {isDark ? 'Light' : 'Dark'}
                </motion.span>
            </AnimatePresence>
        </motion.button>
    );
}

function VoiceCTA({ isLight, pathname }: { isLight: boolean; pathname: string }) {
    const [hovered, setHovered] = useState(false);
    if (pathname === '/chat') return null;

    return (
        <Link
            href="/chat"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '7px 16px', borderRadius: 100,
                textDecoration: 'none',
                background: hovered
                    ? isLight ? 'rgba(26,92,58,0.90)' : 'var(--gold-bright)'
                    : isLight ? 'rgba(26,92,58,0.80)' : 'var(--gold)',
                color: isLight ? '#fff' : '#0c0a06',
                border: isLight
                    ? '1px solid rgba(26,92,58,0.50)'
                    : '1px solid rgba(232,172,68,0.4)',
                fontFamily: 'var(--font-display)', fontWeight: 700,
                fontSize: 12, letterSpacing: '-0.01em',
                boxShadow: isLight
                    ? hovered
                        ? '0 6px 24px rgba(26,92,58,0.30), 0 1px 0 rgba(255,255,255,0.22) inset'
                        : '0 4px 16px rgba(26,92,58,0.22), 0 1px 0 rgba(255,255,255,0.18) inset'
                    : hovered
                        ? '0 6px 24px rgba(200,146,42,0.40), 0 1px 0 rgba(255,255,255,0.22) inset'
                        : '0 4px 14px rgba(200,146,42,0.28), 0 1px 0 rgba(255,255,255,0.15) inset',
                transform: hovered ? 'translateY(-1px)' : 'none',
                transition: 'all 0.22s ease',
                whiteSpace: 'nowrap',
            }}
        >
            <MicIcon />
            Launch
        </Link>
    );
}

function ScrollProgress({ isLight }: { isLight: boolean }) {
    const { scrollYProgress } = useScroll();
    const scaleX = useTransform(scrollYProgress, [0, 1], [0, 1]);

    return (
        <motion.div
            style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: '1.5px', scaleX, originX: 0,
                background: isLight
                    ? 'linear-gradient(90deg, rgba(26,92,58,0.0), rgba(26,92,58,0.5), rgba(82,168,113,0.8), rgba(26,92,58,0.5), rgba(26,92,58,0.0))'
                    : 'linear-gradient(90deg, rgba(200,146,42,0.0), rgba(200,146,42,0.5), rgba(232,172,68,0.8), rgba(200,146,42,0.5), rgba(200,146,42,0.0))',
                opacity: 0.8,
            }}
        />
    );
}


export function Navbar() {
    const pathname = usePathname();
    const [isDark, setIsDark] = useState(true);
    const [mounted, setMounted] = useState(false);
    const [scrolled, setScrolled] = useState(false);
    const [scrollY, setScrollY] = useState(0);

    const isLight = !isDark;

    useEffect(() => {
        setMounted(true);
        const dark = getTheme();
        setIsDark(dark);
        applyTheme(dark);
    }, []);

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY;
            setScrollY(y);
            setScrolled(y > 10);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDark(!document.documentElement.hasAttribute('data-theme'));
        });
        observer.observe(document.documentElement, {
            attributes: true, attributeFilter: ['data-theme', 'class'],
        });
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'l' || e.key === 'L' || e.key === 'd' || e.key === 'D')) {
                e.preventDefault();
                setIsDark(toggleTheme());
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    function handleToggleTheme() {
        setIsDark(toggleTheme());
    }

    if (!mounted) return null;

    const navBg = scrolled
        ? isLight
            ? 'rgba(248, 251, 248, 0.92)'
            : 'rgba(8, 8, 12, 0.88)'
        : 'transparent';

    const borderBottom = scrolled
        ? isLight
            ? '1px solid rgba(26,92,58,0.10)'
            : '1px solid rgba(255,255,255,0.05)'
        : '1px solid transparent';

    return (
        <motion.nav
            initial={{ y: -60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
                height: 58,
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 24px',
                background: navBg,
                backdropFilter: scrolled ? 'blur(28px) saturate(1.4)' : 'none',
                WebkitBackdropFilter: scrolled ? 'blur(28px) saturate(1.4)' : 'none',
                borderBottom,
                transition: 'background 0.3s ease, border-color 0.3s ease',
            }}
        >
            <ScrollProgress isLight={isLight} />

            <JocastaLogo isLight={isLight} />

            <NavPill isLight={isLight} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ThemeToggle isDark={isDark} isLight={isLight} onToggle={handleToggleTheme} />
                <VoiceCTA isLight={isLight} pathname={pathname} />
            </div>

            <style>{`
        nav * { box-sizing: border-box; }
      `}</style>
        </motion.nav>
    );
}