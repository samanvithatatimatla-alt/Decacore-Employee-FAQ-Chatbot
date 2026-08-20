import { Outlet, useLocation } from 'react-router-dom';
import NewsTicker from './NewsTicker';
import TopNav from './TopNav';
import Sidebar from './Sidebar';
import AmbientBackground from './AmbientBackground';
import { useAppState } from '../../context/AppStateContext';
import styles from './AppShell.module.css';

export default function AppShell() {
  const location = useLocation();
  const { state } = useAppState();
  // Company news stays up for the whole chat. It used to hide the moment the first
  // message was sent, which read as the banner disappearing rather than as intent.
  const showTicker = location.pathname === '/chat';

  // Toned down once there's an active conversation, so the moving background
  // doesn't compete with the answer text someone is trying to read.
  const chatActive = location.pathname === '/chat' && state.chat.chatStarted;

  return (
    <div className={styles.app}>
      <AmbientBackground intensity={chatActive ? 0.5 : 1} radius={chatActive ? 120 : 180} />
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
