import { useAppState } from '../../context/AppStateContext';
import ThemeToggle from '../common/ThemeToggle';
import styles from './TopNav.module.css';

export default function TopNav() {
  const { dispatch } = useAppState();
  return (
    <nav className={styles.nav}>
      <button className={styles.burger} onClick={() => dispatch({ type: 'TOGGLE_SIDEBAR' })} aria-label="Toggle sidebar">
        <span />
        <span />
        <span />
      </button>
      <span className={styles.brand}>QBot</span>
      <ThemeToggle className={styles.themeToggle} />
    </nav>
  );
}
