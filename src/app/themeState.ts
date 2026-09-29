import { createContext, useContext } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export const THEME_KEY = 'nodal.appearance';
export function readThemeMode(value?: string | null): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export const ThemeContext = createContext<{ mode: ThemeMode; resolved: 'light' | 'dark'; setMode: (mode: ThemeMode) => void }>({ mode: 'system', resolved: 'light', setMode: () => {} });
export const useTheme = () => useContext(ThemeContext);
