// utils/theme.ts
//
// Central theme manager for Jocasta.
// Handles: apply, toggle, persist, sound effects, toast callbacks.
//
// Usage:
//   import { applyTheme, toggleTheme, getTheme } from '@/utils/theme';

// ── Sound synthesis ──────────────────────────────────────────────────────────

function createAudioCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        return new AC();
    } catch {
        return null;
    }
}

function playThemeSound(toDark: boolean) {
    const ctx = createAudioCtx();
    if (!ctx) return;

    if (toDark) {
        // Dark: descending warm tones — like powering down into deep space
        const notes = [880, 698.46, 523.25, 392];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            const t = ctx.currentTime + i * 0.11;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
            osc.start(t);
            osc.stop(t + 0.5);
        });
    } else {
        // Light: ascending bright tones — like sunrise powering up
        const notes = [392, 523.25, 698.46, 1046.5];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            filter.type = 'lowpass';
            filter.frequency.value = 2400;
            osc.frequency.setValueAtTime(freq, ctx.currentTime);
            const t = ctx.currentTime + i * 0.1;
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.14, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t);
            osc.stop(t + 0.55);
        });
    }
}

// ── Toast callback registry ───────────────────────────────────────────────────

type ToastFn = (title: string, message: string, variant?: 'dark' | 'light' | 'info') => void;
let _toastFn: ToastFn | null = null;

export function registerThemeToastFn(fn: ToastFn) {
    _toastFn = fn;
}

function fireToast(toDark: boolean) {
    if (!_toastFn) return;
    if (toDark) {
        _toastFn('Dark Mode', 'Switched to dark theme', 'dark');
    } else {
        _toastFn('Light Mode', 'Switched to light theme', 'light');
    }
}

// ── Core apply ───────────────────────────────────────────────────────────────

export function applyTheme(dark: boolean, opts?: { sound?: boolean; toast?: boolean }) {
    if (typeof window === 'undefined') return;
    const html = document.documentElement;

    if (dark) {
        html.removeAttribute('data-theme');
        html.classList.remove('light');
        html.classList.add('dark');
    } else {
        html.setAttribute('data-theme', 'light');
        html.classList.remove('dark');
        html.classList.add('light');
    }

    // Force CSS variable refresh on all known panels
    // by triggering a tiny reflow on body
    document.body.style.display = 'none';
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    document.body.offsetHeight; // reflow
    document.body.style.display = '';

    if (opts?.sound) playThemeSound(dark);
    if (opts?.toast) fireToast(dark);

    localStorage.setItem('jocasta-theme', dark ? 'dark' : 'light');
}

// ── Toggle ───────────────────────────────────────────────────────────────────

export function toggleTheme(): boolean {
    const current = getTheme();
    const next = !current;
    applyTheme(next, { sound: true, toast: true });
    return next;
}

// ── Read current ─────────────────────────────────────────────────────────────

export function getTheme(): boolean /* isDark */ {
    if (typeof window === 'undefined') return true;
    const saved = localStorage.getItem('jocasta-theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ── Init (call once at app start) ────────────────────────────────────────────

export function initTheme() {
    const dark = getTheme();
    applyTheme(dark); // no sound/toast on init
}