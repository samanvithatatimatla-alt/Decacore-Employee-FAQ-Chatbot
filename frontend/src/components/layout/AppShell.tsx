import { Outlet, useLocation } from 'react-router-dom';
import NewsTicker from './NewsTicker';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import styles from './AppShell.module.css';

export default function AppShell() {
  const location = useLocation();
  // Company news stays up for the whole chat. It used to hide the moment the first
  // message was sent, which read as the banner disappearing rather than as intent.
  const showTicker = location.pathname === '/chat';

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
