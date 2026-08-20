import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import styles from './ThemeToggle.module.css';

/**
 * Light/dark switch.
 *
 * Shows the theme you would get by pressing it, not the one you are in — a sun while
 * dark, a moon while light. That is the convention people expect from a single-button
 * toggle, and the label says it outright so there is no guessing either way.
 */
export default function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      className={className ? `${styles.button} ${className}` : styles.button}
      onClick={toggle}
      // aria-label rather than a title alone: a title is invisible to touch users and
      // unreliable to screen readers.
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === 'dark' ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
    </button>
  );
}
