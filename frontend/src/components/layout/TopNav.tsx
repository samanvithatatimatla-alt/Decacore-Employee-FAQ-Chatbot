import { useAppState } from '../../context/AppStateContext';
import ThemeToggle from '../common/ThemeToggle';
import styles from './TopNav.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function TopNav() {
  const { state, dispatch } = useAppState();
  const open = state.ui.sidebarOpen;
  return (
    <nav className={styles.nav}>
      {/*
        Adapted from uiverse.io/GreyD097/spicy-ape-9, whose three tiles fan apart from
        a stack on hover — rotated to run vertically, which is the axis a stack of bars
        already reads on.

        It stays one control with two states rather than becoming the original's
        three-action speed dial: this is the sidebar's collapse toggle, and fanning
        three separate destinations out of it would hide navigation behind a hover.
        aria-expanded is what actually communicates the state; the chevron is the
        visual half of the same thing.
      */}
      <button
        className={cx(styles.burger, !open && styles.collapsed)}
        onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })}
        aria-label={open ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-expanded={open}
        title={open ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <span />
        <span />
        <span />
      </button>
      <span className={styles.brand}>QBot</span>
      <ThemeToggle className={styles.themeToggle} />
    </nav>
  );
}
