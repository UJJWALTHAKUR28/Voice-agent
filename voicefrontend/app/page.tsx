'use client';

// app/page.tsx  —  Jocasta Landing
// Iron Man aesthetic: deep void, oxidised gold, terminal mono
// Particle orb visualiser on hover/idle, full-screen immersive layout

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'motion/react';
import Link from 'next/link';

/* ── Orbital Sphere Canvas ──────────────────────────────────────────────── */
function OrbitalSphere({ isActive }: { isActive: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const W = canvas.width = 420;
    const H = canvas.height = 420;
    const cx = W / 2, cy = H / 2;
    const R = 150;  // sphere radius

    /* Generate nodes on sphere surface via fibonacci lattice */
    const N = 180;
    const nodes: { x: number; y: number; z: number; phi: number; theta: number }[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      nodes.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, phi: 0, theta: 0 });
    }

    /* Edges: connect nearby nodes */
    const edges: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dz = nodes[i].z - nodes[j].z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 0.38) edges.push([i, j]);
      }
    }

    /* Pulse rings for active state */
    let pulseT = 0;

    function draw(t: number) {
      ctx.clearRect(0, 0, W, H);
      const speed = isActive ? 0.004 : 0.0018;
      timeRef.current += speed;
      const angle = timeRef.current;
      const tiltX = 0.38;  // lean
      pulseT += isActive ? 0.06 : 0.025;

      /* Project 3D → 2D with Y-axis rotation + slight X-tilt */
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);

      function project(nx: number, ny: number, nz: number) {
        /* Rotate around Y */
        const rx = nx * cosA + nz * sinA;
        const ry = ny;
        const rz = -nx * sinA + nz * cosA;
        /* Tilt around X */
        const fy = ry * cosX - rz * sinX;
        const fz = ry * sinX + rz * cosX;
        const fov = 460;
        const scale = fov / (fov + fz * R);
        return { px: cx + rx * R * scale, py: cy + fy * R * scale, z: fz, scale };
      }

      /* Draw edges */
      for (const [a, b] of edges) {
        const pA = project(nodes[a].x, nodes[a].y, nodes[a].z);
        const pB = project(nodes[b].x, nodes[b].y, nodes[b].z);
        const zAvg = (pA.z + pB.z) / 2;
        const vis = (zAvg + 1) / 2;  // 0 = back, 1 = front
        const alpha = vis * (isActive ? 0.55 : 0.28);
        const grd = ctx.createLinearGradient(pA.px, pA.py, pB.px, pB.py);
        grd.addColorStop(0, `rgba(200,146,42,${alpha * 0.7})`);
        grd.addColorStop(0.5, `rgba(232,172,68,${alpha})`);
        grd.addColorStop(1, `rgba(200,146,42,${alpha * 0.7})`);
        ctx.beginPath();
        ctx.moveTo(pA.px, pA.py);
        ctx.lineTo(pB.px, pB.py);
        ctx.strokeStyle = grd;
        ctx.lineWidth = vis * (isActive ? 0.9 : 0.5);
        ctx.stroke();
      }

      /* Draw nodes */
      for (let i = 0; i < N; i++) {
        const p = project(nodes[i].x, nodes[i].y, nodes[i].z);
        const vis = (p.z + 1) / 2;
        const r = vis * (isActive ? 2.2 : 1.4);
        const alpha = vis * (isActive ? 0.9 : 0.55);

        ctx.beginPath();
        ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,172,68,${alpha})`;
        ctx.fill();

        /* Halo for front nodes when active */
        if (isActive && vis > 0.85 && r > 1.8) {
          ctx.beginPath();
          ctx.arc(p.px, p.py, r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(200,146,42,${alpha * 0.10})`;
          ctx.fill();
        }
      }

      /* Pulse rings radiating outward when active */
      if (isActive) {
        for (let ring = 0; ring < 3; ring++) {
          const phase = (pulseT * 0.4 + ring * 0.7) % 1;
          const rr = R * (0.9 + phase * 0.65);
          const a = (1 - phase) * 0.18;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(200,146,42,${a})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      /* Equatorial glow disc */
      const disc = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 1.1);
      disc.addColorStop(0, `rgba(200,146,42,${isActive ? 0.04 : 0.015})`);
      disc.addColorStop(1, 'rgba(200,146,42,0)');
      ctx.beginPath();
      ctx.ellipse(cx, cy + R * 0.06, R * 1.05, R * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = disc;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [isActive]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '420px',
        height: '420px',
        maxWidth: '90vw',
        maxHeight: '90vw',
        filter: isActive
          ? 'drop-shadow(0 0 40px rgba(200,146,42,0.35)) drop-shadow(0 0 80px rgba(200,146,42,0.15))'
          : 'drop-shadow(0 0 18px rgba(200,146,42,0.18))',
        transition: 'filter 0.8s ease',
        cursor: 'pointer',
      }}
    />
  );
}

/* ── Scan Line Overlay ───────────────────────────────────────────────────── */
function ScanLine() {
  return (
    <div style={{
      position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '2px',
        background: 'linear-gradient(90deg, transparent, rgba(200,146,42,0.06), rgba(200,146,42,0.12), rgba(200,146,42,0.06), transparent)',
        animation: 'scan-line 10s linear infinite',
        animationDelay: '2s',
      }} />
    </div>
  );
}

/* ── Capability Chip ────────────────────────────────────────────────────── */
function Chip({ label, delay }: { label: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        padding: '6px 14px',
        borderRadius: '100px',
        border: '1px solid var(--border-mid)',
        background: 'var(--bg-glass)',
        fontSize: '12px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--text-secondary)',
        letterSpacing: '0.03em',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%',
        background: 'var(--gold)', flexShrink: 0,
        boxShadow: '0 0 6px var(--gold-glow)',
      }} />
      {label}
    </motion.div>
  );
}

/* ── Landing Page ────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [hovered, setHovered] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  const capabilities = [
    'Real-time voice', 'Neural synthesis', 'Contextual memory',
    'Tool execution', 'Multi-modal input', 'Adaptive persona',
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: 'var(--bg-void)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Atmospheric gradient */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `
          radial-gradient(ellipse 70% 60% at 50% 50%, rgba(200,146,42,0.04) 0%, transparent 70%),
          radial-gradient(ellipse 40% 30% at 20% 80%, rgba(93,93,180,0.03) 0%, transparent 60%),
          radial-gradient(ellipse 50% 40% at 80% 20%, rgba(45,212,160,0.02) 0%, transparent 60%)
        `,
      }} />

      <ScanLine />
      <div className="noise-overlay" />

      {/* Grid pattern */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.025,
        backgroundImage: `
          linear-gradient(var(--border-mid) 1px, transparent 1px),
          linear-gradient(90deg, var(--border-mid) 1px, transparent 1px)
        `,
        backgroundSize: '60px 60px',
      }} />

      {/* ── Main content ── */}
      <AnimatePresence>
        {ready && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            style={{
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '0',
              padding: '24px',
              position: 'relative', zIndex: 10,
              textAlign: 'center',
              width: '100%', maxWidth: '680px',
            }}
          >
            {/* System label */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.5 }}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '5px 14px',
                border: '1px solid var(--border-dim)',
                borderRadius: '100px',
                marginBottom: '32px',
              }}
            >
              <span style={{
                width: '6px', height: '6px', borderRadius: '50%',
                background: 'var(--c-listen)',
                boxShadow: '0 0 8px rgba(45,212,160,0.6)',
                animation: 'pulse-soft 2s ease infinite',
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '11px',
                color: 'var(--text-muted)', letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}>
                JOCASTA.AI // SYSTEM ONLINE
              </span>
            </motion.div>

            {/* Orb */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
              onHoverStart={() => setHovered(true)}
              onHoverEnd={() => setHovered(false)}
              style={{ marginBottom: '36px', cursor: 'pointer' }}
            >
              <OrbitalSphere isActive={hovered} />
            </motion.div>

            {/* Title */}
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(42px, 7vw, 72px)',
                fontWeight: 800,
                letterSpacing: '-0.04em',
                lineHeight: 0.95,
                color: 'var(--text-primary)',
                marginBottom: '16px',
              }}
            >
              Jocasta
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, duration: 0.6 }}
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '15px',
                fontWeight: 300,
                color: 'var(--text-secondary)',
                maxWidth: '360px',
                lineHeight: 1.7,
                marginBottom: '36px',
                letterSpacing: '0.01em',
              }}
            >
              Advanced neural voice intelligence. Speak naturally,
              think together, act with precision.
            </motion.p>

            {/* Capabilities row */}
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '8px',
              justifyContent: 'center', marginBottom: '48px',
              maxWidth: '480px',
            }}>
              {capabilities.map((cap, i) => (
                <Chip key={cap} label={cap} delay={0.5 + i * 0.06} />
              ))}
            </div>

            {/* CTA */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.82, duration: 0.5 }}
            >
              <Link
                href="/chat"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '12px',
                  padding: '15px 36px',
                  borderRadius: '100px',
                  background: 'var(--gold)',
                  color: '#0c0a06',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '15px',
                  letterSpacing: '-0.01em',
                  textDecoration: 'none',
                  border: '1px solid rgba(232,172,68,0.4)',
                  boxShadow: '0 0 0 1px rgba(200,146,42,0.2), 0 8px 32px rgba(200,146,42,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
                  transition: 'all 0.25s ease',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = 'var(--gold-bright)';
                  el.style.transform = 'translateY(-2px)';
                  el.style.boxShadow = '0 0 0 1px rgba(232,172,68,0.3), 0 12px 40px rgba(200,146,42,0.4), inset 0 1px 0 rgba(255,255,255,0.2)';
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.background = 'var(--gold)';
                  el.style.transform = 'translateY(0)';
                  el.style.boxShadow = '0 0 0 1px rgba(200,146,42,0.2), 0 8px 32px rgba(200,146,42,0.3), inset 0 1px 0 rgba(255,255,255,0.15)';
                }}
              >
                Initialise Interface
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            </motion.div>

            {/* Footer note */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1, duration: 0.5 }}
              style={{
                marginTop: '24px',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--text-muted)',
                letterSpacing: '0.06em',
              }}
            >
              Requires microphone · Chrome / Firefox / Safari 17+
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}