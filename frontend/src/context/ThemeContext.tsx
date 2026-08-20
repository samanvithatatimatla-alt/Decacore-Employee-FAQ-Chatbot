import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';

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

/**
 * Write the theme to <html>.
 *
 * Called the moment the theme is decided rather than only from an effect, because
 * effects flush children-first: a descendant reading `getComputedStyle` in its own
 * effect would otherwise run *before* the provider updated the attribute and see the
 * previous theme's values. AmbientBackground does exactly that to colour its canvas,
 * and the result was a background that vanished on every switch — it picked up the
 * outgoing theme's dot colour, which is by definition invisible against the incoming
 * theme's background.
 */
function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

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

  // Layout effect, not passive: it still has to cover the first mount and any path
  // that sets the theme without going through `toggle`, and layout effects flush
  // before passive ones, so a child reading computed style is never a step behind.
  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!followingSystem) return;
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!query) return;
    const onChange = () => {
      const next = systemTheme();
      applyTheme(next);
      setTheme(next);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [followingSystem]);

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    // Applied synchronously, before React re-renders, so the DOM is already correct
    // by the time any child effect reads from it. Deliberately outside the setTheme
    // updater — StrictMode invokes updaters twice, and side effects do not belong
    // somewhere that is expected to be pure.
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Choice does not survive the session, but the app still switches.
    }
    setTheme(next);
    setFollowingSystem(false);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle, followingSystem }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside a ThemeProvider');
  return context;
}
