import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

/** Shared with the inline script in index.html — change both together or neither. */
export const THEME_STORAGE_KEY = 'qbot-theme';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  /** True while following the OS rather than an explicit choice the user has made. */
  followingSystem: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Safari in private mode throws on localStorage. Falling back to the system
    // preference is a working app; an unhandled throw here is a blank screen.
    return null;
  }
}

/**
 * Light/dark theming.
 *
 * The theme is an attribute on <html>, not React state that components read — CSS
 * variables in index.css do the work, so a component never has to know which theme is
 * active and nothing re-renders on a switch.
 *
 * Until someone picks explicitly, the app follows the OS and keeps following it: a
 * laptop that flips to dark at sunset takes the app with it. The first toggle writes a
 * choice to localStorage and that choice wins from then on.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme());
  const [followingSystem, setFollowingSystem] = useState(() => storedTheme() === null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!followingSystem) return;
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!query) return;
    const onChange = () => setTheme(systemTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [followingSystem]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Choice does not survive the session, but the app still switches.
      }
      return next;
    });
    setFollowingSystem(false);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggle, followingSystem }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
