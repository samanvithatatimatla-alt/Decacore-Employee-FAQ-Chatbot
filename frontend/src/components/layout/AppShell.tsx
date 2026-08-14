import { Outlet, useLocation } from 'react-router-dom';
import NewsTicker from './NewsTicker';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import { useAppState } from '../../context/AppStateContext';
import styles from './AppShell.module.css';

export default function AppShell() {
  const location = useLocation();
  const { state } = useAppState();
  const showTicker = location.pathname === '/chat' && !state.chat.chatStarted;

  return (
    <div className={styles.app}>
      {showTicker && <NewsTicker />}
      <TopNav />
      <div className={styles.bodyRow}>
        <Sidebar />
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
