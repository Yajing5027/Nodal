import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ThemeContext, readThemeMode, THEME_KEY, type ThemeMode } from './themeState';
function savedMode(): ThemeMode {
  try { return readThemeMode(localStorage.getItem(THEME_KEY)); } catch { return 'system'; }
}
const systemIsDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
function subscribeSystem(callback: () => void) {
  if (typeof matchMedia !== 'function') return () => {};
  const media = matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(savedMode);
  const darkSystem = useSyncExternalStore(subscribeSystem, systemIsDark, () => false);
  const resolved = mode === 'system' ? darkSystem ? 'dark' : 'light' : mode;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    document.documentElement.classList.toggle('dark-theme', resolved === 'dark');
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* Appearance still works when storage is unavailable. */ }
  }, [mode, resolved]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === THEME_KEY || event.key === null) setMode(readThemeMode(event.newValue)); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}
