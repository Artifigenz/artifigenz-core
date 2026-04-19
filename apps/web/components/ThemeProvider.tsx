'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Mode = 'light' | 'dark' | 'system';
type VisualTheme = 'terminal' | 'aura';

interface ThemeContextType {
  theme: Mode;
  setTheme: (theme: Mode) => void;
  resolvedTheme: 'light' | 'dark';
  visualTheme: VisualTheme;
  setVisualTheme: (theme: VisualTheme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useState<Mode>('system');
  const [visualTheme, setVisualTheme] = useState<VisualTheme>('aura');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const storedMode = localStorage.getItem('theme') as Mode | null;
    const storedVisual = localStorage.getItem('visualTheme') as VisualTheme | null;
    if (storedMode) setTheme(storedMode);
    if (storedVisual) setVisualTheme(storedVisual);
  }, []);

  // Handle light/dark mode
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    let isDark: boolean;
    if (theme === 'system') {
      isDark = systemDark;
    } else {
      isDark = theme === 'dark';
    }

    setResolvedTheme(isDark ? 'dark' : 'light');

    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    localStorage.setItem('theme', theme);
  }, [theme, mounted]);

  // Handle visual theme
  useEffect(() => {
    if (!mounted) return;

    const root = document.documentElement;
    root.setAttribute('data-theme', visualTheme);
    localStorage.setItem('visualTheme', visualTheme);
  }, [visualTheme, mounted]);

  // Handle system preference changes
  useEffect(() => {
    if (!mounted) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (theme === 'system') {
        const isDark = mediaQuery.matches;
        setResolvedTheme(isDark ? 'dark' : 'light');
        if (isDark) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, mounted]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, visualTheme, setVisualTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
