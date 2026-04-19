'use client';

import { useEffect } from 'react';
import { useTheme } from '@/components/ThemeProvider';

export default function AuraGradient() {
  const { visualTheme } = useTheme();

  useEffect(() => {
    if (visualTheme !== 'aura') return;

    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;
    let raf: number;

    const handleMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
    };

    const animate = () => {
      x += (targetX - x) * 0.04;
      y += (targetY - y) * 0.04;
      document.body.style.setProperty('--mouse-x', `${x}px`);
      document.body.style.setProperty('--mouse-y', `${y}px`);
      raf = requestAnimationFrame(animate);
    };

    document.addEventListener('mousemove', handleMove);
    raf = requestAnimationFrame(animate);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(raf);
      document.body.style.removeProperty('--mouse-x');
      document.body.style.removeProperty('--mouse-y');
    };
  }, [visualTheme]);

  return null;
}
