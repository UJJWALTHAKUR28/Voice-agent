'use client';


import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence, useScroll, useTransform, useSpring, useMotionValue } from 'motion/react';
import Link from 'next/link';

function JARVISSphere({ isActive, size = 440 }: { isActive: boolean; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef(0);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const DPR = window.devicePixelRatio || 1;
    const pad = size * 0.25;
    const canvasSize = size + pad * 2;
    canvas.width = canvasSize * DPR;
    canvas.height = canvasSize * DPR;
    canvas.style.width = canvasSize + 'px';
    canvas.style.height = canvasSize + 'px';
    const ctx = canvas.getContext('2d')!;
    ctx.scale(DPR, DPR);
    const W = canvasSize, H = canvasSize;
    const cx = W / 2, cy = H / 2;
    const R = size * 0.34;

    const N = 200;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const nodes: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      nodes.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
    }
    const edges: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dz = nodes[i].z - nodes[j].z;
        if (dx * dx + dy * dy + dz * dz < 0.15) edges.push([i, j]);
      }
    }

    const rings = [
      { rx: 1.2, ry: 0.0, rz: 0.0, rm: 1.22, speed: 0.6, phase: 0 },
      { rx: 0.6, ry: 0.8, rz: 0.0, rm: 1.38, speed: -0.4, phase: 1.0 },
      { rx: 0.2, ry: 0.3, rz: 1.1, rm: 1.55, speed: 0.25, phase: 2.1 },
      { rx: 1.5, ry: 0.5, rz: 0.3, rm: 1.18, speed: -0.8, phase: 0.5 },
    ];

    const blips = rings.map((_, ri) => ({
      t: ri * 0.25,
      speed: 0.8 + ri * 0.3,
    }));

    let pulseT = 0;
    let breatheT = 0;

    function getThemeColors() {
      const isLight = document.documentElement.hasAttribute('data-theme') ||
        document.documentElement.classList.contains('light');
      if (isLight) {
        return {
          nodeColor: 'rgba(46, 125, 82,',
          edgeMid: 'rgba(46, 125, 82,',
          edgeEnd: 'rgba(26, 92, 58,',
          ringColor: 'rgba(26, 92, 58,',
          haloColor: 'rgba(26, 92, 58,',
          blipColor: 'rgba(107, 124, 60,',
        };
      }
      return {
        nodeColor: 'rgba(232, 172, 68,',
        edgeMid: 'rgba(232, 172, 68,',
        edgeEnd: 'rgba(200, 146, 42,',
        ringColor: 'rgba(200, 146, 42,',
        haloColor: 'rgba(200, 146, 42,',
        blipColor: 'rgba(45, 212, 160,',
      };
    }

    function draw() {
      const active = activeRef.current;
      const colors = getThemeColors();
      const speed = active ? 0.005 : 0.0022;
      timeRef.current += speed;
      pulseT += active ? 0.07 : 0.028;
      breatheT += 0.018;

      const breathe = 1 + Math.sin(breatheT) * (active ? 0.05 : 0.015);
      const angle = timeRef.current;
      const tiltX = 0.32;
      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const cosX = Math.cos(tiltX), sinX = Math.sin(tiltX);
      const Rb = R * breathe;

      ctx.clearRect(0, 0, W, H);

      function project(nx: number, ny: number, nz: number) {
        const rx = nx * cosA + nz * sinA;
        const ry = ny;
        const rz = -nx * sinA + nz * cosA;
        const fy = ry * cosX - rz * sinX;
        const fz = ry * sinX + rz * cosX;
        const fov = 500;
        const sc = fov / (fov + fz * Rb);
        return { px: cx + rx * Rb * sc, py: cy + fy * Rb * sc, z: fz, sc };
      }

      const haloStrength = active ? 0.18 : 0.09;
      const halo = ctx.createRadialGradient(cx, cy, Rb * 0.2, cx, cy, Rb * 1.8);
      halo.addColorStop(0, `${colors.haloColor}${haloStrength})`);
      halo.addColorStop(0.5, `${colors.haloColor}${haloStrength * 0.4})`);
      halo.addColorStop(1, `${colors.haloColor}0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      const innerGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Rb * 0.7);
      innerGlow.addColorStop(0, `${colors.haloColor}${active ? 0.12 : 0.07})`);
      innerGlow.addColorStop(1, `${colors.haloColor}0)`);
      ctx.beginPath();
      ctx.arc(cx, cy, Rb * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = innerGlow;
      ctx.fill();

      for (const [a, b] of edges) {
        const pA = project(nodes[a].x, nodes[a].y, nodes[a].z);
        const pB = project(nodes[b].x, nodes[b].y, nodes[b].z);
        const vis = ((pA.z + pB.z) / 2 + 1) / 2;
        const baseA = active ? 0.65 : 0.40;
        const alpha = vis * baseA;
        const grd = ctx.createLinearGradient(pA.px, pA.py, pB.px, pB.py);
        grd.addColorStop(0, `${colors.edgeEnd}${alpha * 0.6})`);
        grd.addColorStop(0.5, `${colors.edgeMid}${alpha})`);
        grd.addColorStop(1, `${colors.edgeEnd}${alpha * 0.6})`);
        ctx.beginPath();
        ctx.moveTo(pA.px, pA.py);
        ctx.lineTo(pB.px, pB.py);
        ctx.strokeStyle = grd;
        ctx.lineWidth = vis * (active ? 0.9 : 0.65);
        ctx.stroke();
      }

      for (let i = 0; i < N; i++) {
        const p = project(nodes[i].x, nodes[i].y, nodes[i].z);
        const vis = (p.z + 1) / 2;
        const r = vis * (active ? 2.4 : 2.0);
        const alpha = vis * (active ? 0.95 : 0.65);
        ctx.beginPath();
        ctx.arc(p.px, p.py, r, 0, Math.PI * 2);
        ctx.fillStyle = `${colors.nodeColor}${alpha})`;
        ctx.fill();
        if (active && vis > 0.8) {
          ctx.beginPath();
          ctx.arc(p.px, p.py, r * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = `${colors.nodeColor}${alpha * 0.08})`;
          ctx.fill();
        }
      }

      rings.forEach((ring, ri) => {
        const ringAngle = timeRef.current * ring.speed + ring.phase;
        const ringR = Rb * ring.rm;

        ctx.save();
        ctx.translate(cx, cy);

        const steps = 120;
        const ringAlpha = active ? 0.75 : 0.65;
        const gapFrac = 0.08;

        ctx.beginPath();
        let first = true;
        for (let s = 0; s <= steps; s++) {
          const t = (s / steps) * Math.PI * 2;
          const modT = ((t / (Math.PI * 2)) + 1) % 1;
          if (modT < gapFrac) continue;

          const rx3 = Math.cos(t) * ringR;
          const ry3 = Math.sin(t) * ringR * Math.cos(ring.rx);
          const rz3 = Math.sin(t) * ringR * Math.sin(ring.rx);

          const rxx = rx3 * Math.cos(ring.ry + angle * 0.3) + rz3 * Math.sin(ring.ry + angle * 0.3);
          const ryy = ry3;
          const rzz = -rx3 * Math.sin(ring.ry + angle * 0.3) + rz3 * Math.cos(ring.ry + angle * 0.3);

          const fov = 500;
          const scl = fov / (fov + rzz * 0.4);
          const px = rxx * scl;
          const py = ryy * scl;

          if (first) { ctx.moveTo(px, py); first = false; }
          else { ctx.lineTo(px, py); }
        }
        ctx.strokeStyle = `${colors.ringColor}${ringAlpha * 0.6})`;
        ctx.lineWidth = active ? 1.4 : 0.9;
        ctx.stroke();
        ctx.restore();

        blips[ri].t = (blips[ri].t + blips[ri].speed * 0.004) % 1;
        const bt = blips[ri].t * Math.PI * 2;
        const bx3 = Math.cos(bt) * ringR;
        const by3 = Math.sin(bt) * ringR * Math.cos(ring.rx);
        const bz3 = Math.sin(bt) * ringR * Math.sin(ring.rx);
        const bxx = bx3 * Math.cos(ring.ry + angle * 0.3) + bz3 * Math.sin(ring.ry + angle * 0.3);
        const byy = by3;
        const fov2 = 500;
        const bscl = fov2 / (fov2 + bz3 * 0.4);
        const bpx = cx + bxx * bscl;
        const bpy = cy + byy * bscl;

        const blipAlpha = active ? 0.95 : 0.8;
        ctx.beginPath();
        ctx.arc(bpx, bpy, active ? 3.5 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `${colors.blipColor}${blipAlpha})`;
        ctx.fill();
        if (active) {
          ctx.beginPath();
          ctx.arc(bpx, bpy, 8, 0, Math.PI * 2);
          ctx.fillStyle = `${colors.blipColor}0.15)`;
          ctx.fill();
        }
      });

      if (active) {
        for (let ring = 0; ring < 4; ring++) {
          const phase = (pulseT * 0.3 + ring * 0.7) % 1;
          const rr = Rb * (0.9 + phase * 0.7);
          const al = (1 - phase) * 0.22;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = `${colors.haloColor}${al})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }

      const disc = ctx.createRadialGradient(cx, cy, Rb * 0.3, cx, cy, Rb * 1.15);
      disc.addColorStop(0, `${colors.haloColor}${active ? 0.06 : 0.04})`);
      disc.addColorStop(1, `${colors.haloColor}0)`);
      ctx.beginPath();
      ctx.ellipse(cx, cy + Rb * 0.05, Rb * 1.1, Rb * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = disc;
      ctx.fill();

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [size]);

  const pad = size * 0.25;

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        margin: `-${pad}px`,
        maxWidth: 'none',
        transition: 'filter 0.8s ease',
        cursor: 'pointer',
      }}
    />
  );
}

function GlassButton({
  href,
  children,
  primary = false,
  onClick,
}: {
  href?: string;
  children: React.ReactNode;
  primary?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [hovered, setHovered] = useState(false);

  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    padding: primary ? '15px 38px' : '15px 26px',
    borderRadius: '100px',
    textDecoration: 'none',
    fontFamily: 'var(--font-display)',
    fontWeight: primary ? 700 : 600,
    fontSize: '14px',
    letterSpacing: '-0.01em',
    cursor: 'pointer',
    border: 'none',
    outline: 'none',
    transition: 'all 0.28s cubic-bezier(0.16,1,0.3,1)',
    position: 'relative' as const,
    overflow: 'hidden',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  };

  // Light theme primary — frosted glass with deep sage tint
  const lightPrimary: React.CSSProperties = {
    background: hovered
      ? 'rgba(26, 92, 58, 0.88)'
      : 'rgba(26, 92, 58, 0.76)',
    color: '#ffffff',
    border: '1px solid rgba(26, 92, 58, 0.60)',
    boxShadow: hovered
      ? '0 0 0 1px rgba(26,92,58,0.20), 0 16px 48px rgba(26,92,58,0.32), 0 4px 12px rgba(26,92,58,0.18), inset 0 1px 0 rgba(255,255,255,0.22)'
      : '0 0 0 1px rgba(26,92,58,0.16), 0 8px 32px rgba(26,92,58,0.22), inset 0 1px 0 rgba(255,255,255,0.18)',
    transform: hovered ? 'translateY(-2px) scale(1.01)' : 'translateY(0) scale(1)',
  };

  // Light theme secondary — pure frosted glass
  const lightSecondary: React.CSSProperties = {
    background: hovered
      ? 'rgba(255, 255, 255, 0.72)'
      : 'rgba(255, 255, 255, 0.52)',
    color: hovered ? '#1a5c3a' : '#354a36',
    border: '1px solid rgba(255, 255, 255, 0.85)',
    boxShadow: hovered
      ? '0 0 0 1px rgba(26,92,58,0.12), 0 12px 36px rgba(26,92,58,0.14), 0 2px 8px rgba(26,92,58,0.08), inset 0 1px 0 rgba(255,255,255,0.95)'
      : '0 0 0 1px rgba(26,92,58,0.08), 0 4px 16px rgba(26,92,58,0.08), inset 0 1px 0 rgba(255,255,255,0.90)',
    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
  };

  // Dark primary
  const darkPrimary: React.CSSProperties = {
    background: hovered ? 'var(--gold-bright)' : 'var(--gold)',
    color: '#0c0a06',
    border: '1px solid rgba(232,172,68,0.4)',
    boxShadow: hovered
      ? '0 0 0 1px rgba(232,172,68,0.3), 0 14px 44px rgba(200,146,42,0.45), inset 0 1px 0 rgba(255,255,255,0.2)'
      : '0 0 0 1px rgba(200,146,42,0.2), 0 8px 32px rgba(200,146,42,0.35), inset 0 1px 0 rgba(255,255,255,0.15)',
    transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
  };

  // Dark secondary
  const darkSecondary: React.CSSProperties = {
    background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
    color: hovered ? 'var(--text-primary)' : 'var(--text-secondary)',
    border: hovered ? '1px solid var(--border-strong)' : '1px solid var(--border-mid)',
    boxShadow: hovered ? '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)' : 'none',
    transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
  };

  const [isLight, setIsLight] = useState(false);
  useEffect(() => {
    const check = () => setIsLight(
      document.documentElement.hasAttribute('data-theme') ||
      document.documentElement.classList.contains('light')
    );
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, []);

  const themeStyle = isLight
    ? (primary ? lightPrimary : lightSecondary)
    : (primary ? darkPrimary : darkSecondary);

  const combined = { ...baseStyle, ...themeStyle };

  if (href) {
    return (
      <Link
        href={href}
        style={combined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Glass sheen — only in light secondary */}
        {isLight && !primary && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)',
            pointerEvents: 'none', borderRadius: '100px 100px 0 0',
          }} />
        )}
        {children}
      </Link>
    );
  }

  return (
    <a
      style={combined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      href="#"
    >
      {isLight && !primary && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, transparent 100%)',
          pointerEvents: 'none', borderRadius: '100px 100px 0 0',
        }} />
      )}
      {children}
    </a>
  );
}


function ScanLine() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', left: 0, right: 0, height: '2px',
        background: 'linear-gradient(90deg, transparent, rgba(200,146,42,0.06), rgba(200,146,42,0.14), rgba(200,146,42,0.06), transparent)',
        animation: 'scan-line 12s linear infinite',
        animationDelay: '1.5s',
      }} />
    </div>
  );
}

function ParallaxColumn({
  index,
  scrollY,
}: {
  index: number;
  scrollY: ReturnType<typeof useMotionValue<number>>;
}) {
  const speed = index === 1 ? -0.12 : index === 0 ? -0.06 : -0.18;
  const y = useTransform(scrollY, v => v * speed);
  const springY = useSpring(y, { stiffness: 60, damping: 20 });

  const cards = [
    { label: 'Deepgram Nova-3 STT', icon: '◈', desc: 'Real-time speech-to-text with automatic fallback to Flux and Ink-Whisper models' },
    { label: 'Cartesia Sonic-3 TTS', icon: '◉', desc: 'Ultra-low-latency neural voice synthesis with Sonic-Turbo and Aura-2 fallbacks' },
    { label: 'GPT-4.1 Mini + Groq', icon: '◆', desc: 'Primary LLM via LiveKit inference with Groq LLaMA 70B and 8B fallback chain' },
    { label: 'Silero VAD', icon: '◇', desc: 'Pre-warmed voice activity detection running locally on CPU at worker startup' },
    { label: 'ML Turn Detection', icon: '◈', desc: 'MultilingualModel predicts turn boundaries — no fixed silence timers' },
  ];

  return (
    <motion.div
      style={{
        y: springY,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        flexShrink: 0,
        width: '280px',
      }}
    >
      {cards.map((card, i) => {
        const bgHues = [
          'rgba(200,146,42,0.06)',
          'rgba(93,164,245,0.05)',
          'rgba(157,123,234,0.06)',
          'rgba(45,212,160,0.05)',
          'rgba(200,146,42,0.04)',
        ];
        const borderHues = [
          'rgba(200,146,42,0.18)',
          'rgba(93,164,245,0.15)',
          'rgba(157,123,234,0.18)',
          'rgba(45,212,160,0.15)',
          'rgba(200,146,42,0.14)',
        ];
        // Light mode card colours
        const lightBg = [
          'rgba(26,92,58,0.05)',
          'rgba(46,125,82,0.04)',
          'rgba(107,124,60,0.05)',
          'rgba(82,168,113,0.04)',
          'rgba(26,92,58,0.04)',
        ];
        const lightBorder = [
          'rgba(26,92,58,0.14)',
          'rgba(46,125,82,0.12)',
          'rgba(107,124,60,0.14)',
          'rgba(82,168,113,0.12)',
          'rgba(26,92,58,0.10)',
        ];

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.92 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ delay: i * 0.06 + index * 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            style={{
              height: i % 2 === 0 ? '220px' : '180px',
              borderRadius: '18px',
              background: bgHues[(i + index) % 5],
              border: `1px solid ${borderHues[(i + index) % 5]}`,
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              position: 'relative',
              overflow: 'hidden',
              cursor: 'default',
            }}
            whileHover={{ scale: 1.02, transition: { duration: 0.3 } }}
          >
            <div style={{
              position: 'absolute',
              right: '-20px', bottom: '-20px',
              width: '100px', height: '100px',
              borderRadius: '50%',
              border: `1px solid ${borderHues[(i + index) % 5]}`,
              opacity: 0.4,
            }} />
            <div style={{
              position: 'absolute',
              right: '10px', bottom: '10px',
              width: '60px', height: '60px',
              borderRadius: '50%',
              border: `1px solid ${borderHues[(i + index) % 5]}`,
              opacity: 0.25,
            }} />

            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '22px',
              color: 'var(--gold)',
              lineHeight: 1,
            }}>{card.icon}</span>

            <div>
              <p style={{
                fontFamily: 'var(--font-display)',
                fontSize: '14px', fontWeight: 700,
                color: 'var(--text-primary)', letterSpacing: '-0.01em', marginBottom: '6px',
              }}>{card.label}</p>
              <p style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '12px', fontWeight: 300,
                color: 'var(--text-secondary)', lineHeight: 1.55,
              }}>{card.desc}</p>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

function FeatureRow({ index, icon, title, body, tag }: {
  index: number; icon: string; title: string; body: string; tag: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'flex', gap: '24px', alignItems: 'flex-start',
        padding: '28px 32px', borderRadius: '20px',
        background: 'var(--bg-glass)', border: '1px solid var(--border-dim)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        cursor: 'default', position: 'relative', overflow: 'hidden',
      }}
      whileHover={{ background: 'var(--bg-glass-hover)', borderColor: 'var(--border-mid)', transition: { duration: 0.2 } }}
    >
      <div style={{
        position: 'absolute', top: '16px', right: '20px',
        fontFamily: 'var(--font-mono)', fontSize: '10px',
        color: 'var(--text-muted)', letterSpacing: '0.1em',
      }}>{tag}</div>
      <div style={{
        width: '48px', height: '48px', borderRadius: '14px',
        background: 'var(--gold-dim)', border: '1px solid var(--gold-glow)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '22px', flexShrink: 0,
      }}>{icon}</div>
      <div>
        <h3 style={{
          fontFamily: 'var(--font-display)', fontSize: '17px', fontWeight: 700,
          color: 'var(--text-primary)', letterSpacing: '-0.02em', marginBottom: '8px',
        }}>{title}</h3>
        <p style={{
          fontFamily: 'var(--font-ui)', fontSize: '14px', fontWeight: 300,
          color: 'var(--text-secondary)', lineHeight: 1.7,
        }}>{body}</p>
      </div>
    </motion.div>
  );
}

function StatTicker() {
  const stats = [
    { value: '6', label: 'Provider fallbacks' },
    { value: 'Nova-3', label: 'Deepgram STT model' },
    { value: 'Sonic-3', label: 'Cartesia TTS model' },
    { value: 'WebRTC', label: 'LiveKit transport' },
    { value: '4', label: 'Live tool actions' },
  ];
  return (
    <div style={{
      display: 'flex', gap: '1px', overflow: 'hidden',
      borderRadius: '16px', border: '1px solid var(--border-dim)',
      background: 'var(--border-dim)',
    }}>
      {stats.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.08, duration: 0.5 }}
          style={{ flex: 1, padding: '20px 16px', background: 'var(--bg-surface)', textAlign: 'center' }}
        >
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 800,
            color: 'var(--gold)', letterSpacing: '-0.02em', marginBottom: '4px',
          }}>{s.value}</div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: '10px',
            color: 'var(--text-muted)', letterSpacing: '0.06em',
          }}>{s.label.toUpperCase()}</div>
        </motion.div>
      ))}
    </div>
  );
}

function Chip({ label, delay }: { label: string; delay: number }) {
  const [isLight, setIsLight] = useState(false);
  useEffect(() => {
    const check = () => setIsLight(
      document.documentElement.hasAttribute('data-theme') ||
      document.documentElement.classList.contains('light')
    );
    check();
    const obs = new MutationObserver(check);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        padding: '6px 14px', borderRadius: '100px',
        border: isLight ? '1px solid rgba(255,255,255,0.75)' : '1px solid var(--border-mid)',
        background: isLight
          ? 'rgba(255,255,255,0.55)'
          : 'var(--bg-glass)',
        fontSize: '12px', fontFamily: 'var(--font-mono)',
        color: isLight ? '#354a36' : 'var(--text-secondary)',
        letterSpacing: '0.04em',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        boxShadow: isLight
          ? '0 1px 4px rgba(15,40,20,0.06), inset 0 1px 0 rgba(255,255,255,0.85)'
          : 'none',
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

function SectionHeading({ tag, title, sub }: { tag: string; title: string; sub: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      style={{ textAlign: 'center', maxWidth: '560px', margin: '0 auto 64px' }}
    >
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '8px',
        padding: '5px 14px', border: '1px solid var(--border-dim)',
        borderRadius: '100px', marginBottom: '20px',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '11px',
          color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>{tag}</span>
      </div>
      <h2 style={{
        fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 44px)',
        fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05,
        color: 'var(--text-primary)', marginBottom: '16px',
      }}>{title}</h2>
      <p style={{
        fontFamily: 'var(--font-ui)', fontSize: '15px', fontWeight: 300,
        color: 'var(--text-secondary)', lineHeight: 1.75,
      }}>{sub}</p>
    </motion.div>
  );
}

export default function LandingPage() {
  const [hovered, setHovered] = useState(false);
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: containerRef });

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 80);
    return () => clearTimeout(t);
  }, []);

  const capabilities = [
    'Deepgram Nova-3', 'Cartesia Sonic-3', 'GPT-4.1 Mini',
    'Silero VAD', 'LiveKit WebRTC', 'Groq LLaMA fallback',
  ];

  const features = [
    {
      icon: '🎙',
      title: 'Deepgram Nova-3 Speech Recognition',
      body: 'Deepgram Nova-3 processes incoming audio in real-time via LiveKit inference. If Nova-3 is unavailable, the pipeline falls back to Flux-General-EN, then Cartesia Ink-Whisper, then direct Deepgram plugin — four layers of STT redundancy.',
      tag: 'STT',
    },
    {
      icon: '🧠',
      title: 'GPT-4.1 Mini + Groq LLaMA Fallback',
      body: 'Primary reasoning runs on OpenAI GPT-4.1 Mini via LiveKit inference. When rate-limited, the agent cascades to Groq LLaMA 3.3 70B (128k context), then LLaMA 3.1 8B — each with a 6-second attempt timeout for predictable voice latency.',
      tag: 'LLM',
    },
    {
      icon: '⚡',
      title: 'Cartesia Sonic-3 Voice Synthesis',
      body: 'Neural TTS via Cartesia Sonic-3 delivers natural speech with ultra-low latency. Falls back to Sonic-Turbo, then Deepgram Aura-2, then direct Cartesia plugin — ensuring voice output never drops, even during provider outages.',
      tag: 'TTS',
    },
    {
      icon: '🌊',
      title: 'Live Tool Execution Pipeline',
      body: 'Jocasta calls live APIs mid-conversation: OpenWeatherMap for weather, NewsAPI for headlines, and a safe AST math evaluator for calculations. Client-side actions (theme toggle, notifications) flow through LiveKit data channels directly to the browser.',
      tag: 'TOOLS',
    },
    {
      icon: '🎨',
      title: 'Silero VAD + ML Turn Detection',
      body: 'Silero VAD (ONNX, local CPU) detects voice activity with 0.4s silence threshold. A pre-warmed MultilingualModel predicts natural turn boundaries using ML — no fixed timers. Both models load at worker startup, not at first session.',
      tag: 'VAD',
    },
    {
      icon: '🔒',
      title: 'LiveKit WebRTC Transport',
      body: 'All audio and data streams run over LiveKit WebRTC with DTLS-SRTP encryption. JWT tokens with 2-hour TTLs gate room access. A dedicated data channel carries JSON events — transcripts, state changes, and tool results — in parallel with audio.',
      tag: 'TRANSPORT',
    },
  ];

  return (
    <div
      ref={containerRef}
      style={{
        height: '100vh', overflowY: 'auto', overflowX: 'hidden',
        scrollBehavior: 'smooth',
        background: 'var(--bg-void)', color: 'var(--text-primary)',
        paddingTop: '56px',
      }}
    >
      {/* ── Atmospheric layers ─────────────────────────────────── */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: `
          radial-gradient(ellipse 70% 60% at 50% 50%, rgba(200,146,42,0.08) 0%, transparent 65%),
          radial-gradient(ellipse 40% 35% at 15% 75%, rgba(93,93,180,0.05) 0%, transparent 60%),
          radial-gradient(ellipse 50% 45% at 85% 20%, rgba(45,212,160,0.035) 0%, transparent 60%)
        `,
      }} />

      <style>{`
        [data-theme="light"] #landing-atmos, html.light #landing-atmos {
          background:
            radial-gradient(ellipse 70% 60% at 50% 40%, rgba(26,92,58,0.07) 0%, transparent 65%),
            radial-gradient(ellipse 45% 40% at 10% 80%, rgba(107,124,60,0.04) 0%, transparent 60%),
            radial-gradient(ellipse 50% 45% at 90% 15%, rgba(82,168,113,0.05) 0%, transparent 60%)
            !important;
        }
      `}</style>
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.022,
        backgroundImage: `linear-gradient(var(--border-mid) 1px, transparent 1px), linear-gradient(90deg, var(--border-mid) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
      }} />

      <ScanLine />
      <div className="noise-overlay" />


      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.6 }}
      >
        <div style={{
          minHeight: 'calc(100vh - 56px)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '60px 24px 80px',
          position: 'relative', zIndex: 1, textAlign: 'center',
        }}>

          {/* JARVIS Sphere */}
          <motion.div
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 1, ease: [0.16, 1, 0.3, 1] }}
            onHoverStart={() => setHovered(true)}
            onHoverEnd={() => setHovered(false)}
            style={{
              marginBottom: '40px', position: 'relative',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'visible',
            }}
          >
            <div style={{
              position: 'absolute', width: '560px', height: '560px', borderRadius: '50%',
              background: 'radial-gradient(circle at 50% 50%, rgba(200,146,42,0.12) 0%, rgba(200,146,42,0.04) 40%, transparent 70%)',
              filter: 'blur(40px)', pointerEvents: 'none',
              animation: 'orb-breathe 6s ease-in-out infinite',
            }} />
            <JARVISSphere isActive={hovered} size={420} />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            style={{
              fontFamily: 'var(--font-display)', fontSize: 'clamp(52px, 8vw, 96px)',
              fontWeight: 800, letterSpacing: '-0.05em', lineHeight: 0.92,
              color: 'var(--text-primary)', marginBottom: '20px',
            }}
          >
            Jocasta
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.6 }}
            style={{
              fontFamily: 'var(--font-ui)', fontSize: '16px', fontWeight: 300,
              color: 'var(--text-secondary)', maxWidth: '440px', lineHeight: 1.75,
              marginBottom: '36px', letterSpacing: '0.01em',
            }}
          >
            Advanced neural voice intelligence. Speak naturally,
            think together, act with precision.
          </motion.p>

          {/* Capabilities — glass chips */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '8px',
            justifyContent: 'center', marginBottom: '52px', maxWidth: '500px',
          }}>
            {capabilities.map((cap, i) => (
              <Chip key={cap} label={cap} delay={0.52 + i * 0.06} />
            ))}
          </div>

          {/* CTA — glass buttons */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, duration: 0.5 }}
            style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}
          >
            <GlassButton href="/chat" primary>
              Initialise Interface
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </GlassButton>

            <GlassButton onClick={(e) => {
              e.preventDefault();
              document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' });
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase' as const }}>
                Learn more
              </span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7l5 5 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </GlassButton>
          </motion.div>

          {/* Scroll hint */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.5 }}
            style={{
              marginTop: '28px', fontFamily: 'var(--font-mono)', fontSize: '11px',
              color: 'var(--text-muted)', letterSpacing: '0.06em',
            }}
          >
            Requires microphone · Chrome / Firefox / Safari 17+
          </motion.p>
        </div>
      </motion.section>

      {/* ════════════════════════════════════════════ STATS ══ */}
      <section style={{ padding: '0 32px 80px', maxWidth: '1100px', margin: '0 auto', position: 'relative', zIndex: 2 }}>
        <StatTicker />
      </section>

      {/* ════════════════════════════════════════════ ABOUT ══ */}
      <section
        id="about"
        style={{ padding: '80px 32px', maxWidth: '1100px', margin: '0 auto', position: 'relative', zIndex: 2 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px', alignItems: 'center' }}>
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            style={{ display: 'flex', justifyContent: 'center', overflow: 'visible' }}
          >
            <div style={{ position: 'relative', overflow: 'visible' }}>
              <JARVISSphere isActive={true} size={280} />
              {['DEEPGRAM', 'GPT-4.1', 'CARTESIA', 'VAD'].map((label, i) => (
                <motion.div
                  key={label}
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  style={{
                    position: 'absolute',
                    fontFamily: 'var(--font-mono)', fontSize: '10px',
                    color: 'var(--gold)', letterSpacing: '0.1em',
                    ...([
                      { top: '10px', left: '50%', transform: 'translateX(-50%)' },
                      { right: '-8px', top: '50%', transform: 'translateY(-50%)' },
                      { bottom: '10px', left: '50%', transform: 'translateX(-50%)' },
                      { left: '-8px', top: '50%', transform: 'translateY(-50%)' },
                    ][i]),
                  }}
                >{label}</motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '4px 12px', border: '1px solid var(--border-dim)',
              borderRadius: '100px', marginBottom: '20px',
            }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: '10px',
                color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>SYSTEM ARCHITECTURE</span>
            </div>

            <h2 style={{
              fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 3.5vw, 40px)',
              fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05,
              color: 'var(--text-primary)', marginBottom: '20px',
            }}>
              Five neural layers.<br />One seamless voice.
            </h2>

            <p style={{
              fontFamily: 'var(--font-ui)', fontSize: '15px', fontWeight: 300,
              color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: '20px',
            }}>
              Jocasta chains five models with automatic fallbacks: Deepgram Nova-3 for
              speech recognition, GPT-4.1 Mini for reasoning and tool calls, Cartesia
              Sonic-3 for voice synthesis, Silero VAD for voice activity detection,
              and a ML turn detector — all orchestrated by a LiveKit Python agent
              running in persistent WebRTC rooms.
            </p>

            <p style={{
              fontFamily: 'var(--font-ui)', fontSize: '15px', fontWeight: 300,
              color: 'var(--text-secondary)', lineHeight: 1.8,
            }}>
              Unlike push-to-talk systems, Jocasta maintains an always-on audio session.
              Silero VAD detects speech automatically, Deepgram transcribes in real-time,
              GPT-4.1 Mini reasons and calls tools (weather, news, math), and Cartesia
              streams synthesised audio back.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '28px' }}>
              {[
                { step: '01', label: 'LiveKit WebRTC capture', color: 'var(--c-listen)' },
                { step: '02', label: 'Silero VAD → Deepgram Nova-3', color: 'var(--c-think)' },
                { step: '03', label: 'GPT-4.1 Mini → tools', color: 'var(--gold)' },
                { step: '04', label: 'Cartesia Sonic-3 → audio', color: 'var(--c-speak)' },
              ].map(s => (
                <div key={s.step} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '10px',
                    color: s.color, letterSpacing: '0.08em', flexShrink: 0, width: '24px',
                  }}>{s.step}</span>
                  <div style={{ flex: 1, height: '1px', background: 'var(--border-dim)' }} />
                  <span style={{
                    fontFamily: 'var(--font-mono)', fontSize: '11px',
                    color: 'var(--text-muted)', letterSpacing: '0.04em',
                  }}>{s.label}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════ PARALLAX ═══ */}
      <section style={{ padding: '80px 32px 100px', overflow: 'hidden', position: 'relative', zIndex: 2 }}>
        <SectionHeading
          tag="PIPELINE"
          title="Five models. Three fallback layers."
          sub="Every provider in the pipeline has automatic fallbacks — if Deepgram drops, Flux takes over. If GPT-4.1 Mini rate-limits, Groq LLaMA activates. Zero downtime by design."
        />

        <div style={{
          display: 'flex', gap: '20px', justifyContent: 'center', alignItems: 'flex-start',
          maxWidth: '920px', margin: '0 auto',
          height: '640px', overflow: 'hidden', borderRadius: '24px', position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none',
            background: `linear-gradient(to bottom, var(--bg-void) 0%, transparent 18%, transparent 82%, var(--bg-void) 100%)`,
          }} />
          {[0, 1, 2].map(i => (
            <ParallaxColumn key={i} index={i} scrollY={scrollY} />
          ))}
        </div>
      </section>

      {/* ════════════════════════════════════════ FEATURES ═══ */}
      <section style={{ padding: '80px 32px 100px', maxWidth: '1100px', margin: '0 auto', position: 'relative', zIndex: 2 }}>
        <SectionHeading
          tag="ARCHITECTURE"
          title="Production pipeline. Every layer redundant."
          sub="Built on LiveKit Agents, Deepgram, Cartesia, GPT-4.1 Mini, and Groq — with pre-warmed ML models and multi-provider fallback at every stage."
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '12px' }}>
          {features.map((f, i) => (
            <FeatureRow key={i} index={i} {...f} />
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════ FINAL CTA ═ */}
      <section style={{ padding: '80px 32px 120px', position: 'relative', zIndex: 2, textAlign: 'center' }}>
        <div style={{
          position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: '600px', height: '400px',
          background: 'radial-gradient(ellipse 60% 60% at 50% 50%, rgba(200,146,42,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          style={{ position: 'relative' }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px', position: 'relative', overflow: 'visible' }}>
            <div style={{
              position: 'absolute', width: '340px', height: '340px', borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(200,146,42,0.10) 0%, transparent 65%)',
              filter: 'blur(30px)', pointerEvents: 'none',
              top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              animation: 'orb-breathe 6s ease-in-out infinite',
            }} />
            <JARVISSphere isActive={true} size={200} />
          </div>

          <h2 style={{
            fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 6vw, 72px)',
            fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 0.95,
            color: 'var(--text-primary)', marginBottom: '20px',
          }}>
            Ready to talk?
          </h2>
          <p style={{
            fontFamily: 'var(--font-ui)', fontSize: '16px', fontWeight: 300,
            color: 'var(--text-secondary)', marginBottom: '40px',
            maxWidth: '320px', margin: '0 auto 40px', lineHeight: 1.7,
          }}>
            One click to connect. No setup, no account. Just speak.
          </p>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <GlassButton href="/chat" primary>
              Begin Voice Session
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="7" y="2" width="4" height="8" rx="2" fill="currentColor" />
                <path d="M4 9a5 5 0 0010 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M9 14v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </GlassButton>
          </div>

          <p style={{
            marginTop: '20px', fontFamily: 'var(--font-mono)', fontSize: '11px',
            color: 'var(--text-muted)', letterSpacing: '0.06em',
          }}>
            ENCRYPTED · EPHEMERAL · PRIVACY-FIRST
          </p>
        </motion.div>
      </section>

      <footer style={{
        borderTop: '1px solid var(--border-dim)', padding: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'relative', zIndex: 2, flexWrap: 'wrap', gap: '16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '24px', height: '24px', borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, var(--gold-bright), var(--gold))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '11px', color: '#0c0a06',
          }}>J</div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
            JOCASTA.AI // 2025 // LIVEKIT + DEEPGRAM + CARTESIA + GPT-4.1
          </span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
          v1.0.0-alpha
        </span>
      </footer>
    </div>
  );
}