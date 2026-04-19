'use client';

import { useEffect, useRef } from 'react';
import styles from './ParticleCanvas.module.css';

interface Particle {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  baseAlpha: number;
  drift: number;
  driftSpeed: number;
  driftRadius: number;
}

const CLUSTER_CENTERS = [
  { x: 0.3, y: 0.4 },
  { x: 0.6, y: 0.5 },
  { x: 0.45, y: 0.6 },
  { x: 0.7, y: 0.35 },
  { x: 0.25, y: 0.55 },
];

export default function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const smoothMouseRef = useRef({ x: -9999, y: -9999 });
  const particlesRef = useRef<Particle[]>([]);
  const animationRef = useRef<number>(0);
  const timeRef = useRef(0);
  const dimensionsRef = useRef({ w: 0, h: 0 });
  const isDarkRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
      dimensionsRef.current = { w, h };

      // Reinitialize particles on resize
      const particleCount = Math.min(1800, Math.floor((w * h) / 600));
      const particles: Particle[] = [];

      for (let i = 0; i < particleCount; i++) {
        const cluster =
          CLUSTER_CENTERS[Math.floor(Math.random() * CLUSTER_CENTERS.length)];
        const spread = 0.18;
        particles.push({
          x: (cluster.x + (Math.random() - 0.5) * spread) * w,
          y: (cluster.y + (Math.random() - 0.5) * spread) * h,
          r: Math.random() * 1.4 + 0.3,
          vx: (Math.random() - 0.5) * 0.08,
          vy: (Math.random() - 0.5) * 0.08,
          baseAlpha: 0.03 + Math.random() * 0.09,
          drift: Math.random() * Math.PI * 2,
          driftSpeed: 0.002 + Math.random() * 0.004,
          driftRadius: 0.3 + Math.random() * 0.5,
        });
      }

      particlesRef.current = particles;
    };

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const animate = () => {
      const { w, h } = dimensionsRef.current;
      const particles = particlesRef.current;
      const mouse = mouseRef.current;
      const smoothMouse = smoothMouseRef.current;

      timeRef.current += 1;
      ctx.clearRect(0, 0, w, h);

      smoothMouse.x += (mouse.x - smoothMouse.x) * 0.06;
      smoothMouse.y += (mouse.y - smoothMouse.y) * 0.06;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        const driftAngle = p.drift + timeRef.current * p.driftSpeed;
        const driftX = Math.sin(driftAngle) * p.driftRadius;
        const driftY = Math.cos(driftAngle * 0.7 + 1.3) * p.driftRadius;

        p.vx += driftX * 0.002;
        p.vy += driftY * 0.002;

        const dx = smoothMouse.x - p.x;
        const dy = smoothMouse.y - p.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const attractRadius = 450;

        if (dist < attractRadius && dist > 1) {
          const force = (1 - dist / attractRadius) * 0.012;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        p.vx *= 0.985;
        p.vy *= 0.985;

        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;

        let alpha = p.baseAlpha;
        if (dist < 300) {
          alpha += (1 - dist / 300) * 0.04;
        }

        const baseGray = isDarkRef.current ? 200 : 42;
        const gray = baseGray + Math.floor(Math.random() * 8);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${gray}, ${gray}, ${gray}, ${alpha})`;
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    const checkDarkMode = () => {
      isDarkRef.current = document.documentElement.classList.contains('dark');
    };
    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('mousemove', handleMouseMove);
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('mousemove', handleMouseMove);
      observer.disconnect();
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className={styles.canvas} />;
}
