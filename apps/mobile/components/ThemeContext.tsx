import { createContext, useContext, useState, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { colors, type ColorTheme } from '../constants/theme';

type Mode = 'auto' | 'light' | 'dark';
type VisualTheme = 'terminal' | 'aura';

type ThemeContextType = {
  mode: Mode;
  setMode: (m: Mode) => void;
  visualTheme: VisualTheme;
  setVisualTheme: (t: VisualTheme) => void;
  isDark: boolean;
  isAura: boolean;
  c: ColorTheme;
};

const ThemeContext = createContext<ThemeContextType>({
  mode: 'auto',
  setMode: () => {},
  visualTheme: 'aura',
  setVisualTheme: () => {},
  isDark: false,
  isAura: true,
  c: colors.auraLight,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setMode] = useState<Mode>('auto');
  const [visualTheme, setVisualTheme] = useState<VisualTheme>('aura');

  const isDark = useMemo(() => {
    if (mode === 'auto') return systemScheme === 'dark';
    return mode === 'dark';
  }, [mode, systemScheme]);

  const isAura = visualTheme === 'aura';

  const c = useMemo((): ColorTheme => {
    if (isAura) return isDark ? colors.auraDark : colors.auraLight;
    return isDark ? colors.dark : colors.light;
  }, [isDark, isAura]);

  return (
    <ThemeContext.Provider value={{ mode, setMode, visualTheme, setVisualTheme, isDark, isAura, c }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
