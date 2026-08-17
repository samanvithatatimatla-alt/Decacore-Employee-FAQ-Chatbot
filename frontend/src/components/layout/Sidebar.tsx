import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, FileText, Folder, Inbox, LayoutGrid, Mail } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import styles from './Sidebar.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { state, dispatch, restoreConversation } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  if (!user) return null;
  const open = state.ui.sidebarOpen;
  const isHrAdmin = user.role === 'hr_admin';

  const isActive = (path: string) => location.pathname === path;

  const newChat = () => {
    dispatch({ type: 'NEW_CHAT' });
    navigate('/chat');
  };

  const recentsTop2 = state.recents.slice(0, 2);

  // Same as the history page: the conversation list carries no messages, so the
  // detail has to be fetched before the thread can render. Naming a recent chat and
  // then dropping the user on the full history list made them find it twice.
  const openRecent = async (convId: number) => {
    await restoreConversation(convId);
    navigate('/chat');
  };

  const handleSignOut = () => {
    setUserMenuOpen(false);
    signOut();
    navigate('/');
  };

  return (
    <aside className={styles.sidebar} style={{ width: open ? 'var(--sidebar-w)' : 'var(--sidebar-w-collapsed)', alignItems: open ? 'stretch' : 'center' }}>
      {open ? (
        <>
          <button className={styles.btnPrimary} onClick={newChat}>
            New chat
          </button>
          <div className={styles.sideScroll}>
            {/*
              HR admins land on the dashboard and spend their day in HR Tools, so that
              group leads for them and Chat/Resources sit under it. Employees keep the
              original order — they have no HR Tools group at all. The divider class
              goes on whichever group is second, so the rule always separates the two
              rather than hanging under the New chat button.
            */}
            {isHrAdmin && (
              <div className={styles.sideNav}>
                <p className={styles.sectionLabel}>HR Tools</p>
                <button className={cx(styles.sideNavItem, isActive('/admin') && styles.active)} onClick={() => navigate('/admin')}>
                  <span className={styles.sideNavIcon}>
                    <LayoutGrid size={14} />
                  </span>
                  Dashboard
                </button>
                <button className={cx(styles.sideNavItem, isActive('/admin/documents') && styles.active)} onClick={() => navigate('/admin/documents')}>
                  <span className={styles.sideNavIcon}>
                    <FileText size={14} />
                  </span>
                  Document Management
                </button>
                <button className={cx(styles.sideNavItem, isActive('/admin/inbox') && styles.active)} onClick={() => navigate('/admin/inbox')}>
                  <span className={styles.sideNavIcon}>
                    <Inbox size={14} />
                  </span>
                  HR Inbox
                  {state.pendingRequests > 0 && <span className={styles.navBadge}>{state.pendingRequests}</span>}
                </button>
              </div>
            )}

            <div className={cx(styles.sideNav, isHrAdmin && styles.navGroupDivider)}>
              <button className={cx(styles.sideNavItem, isActive('/chat') && styles.active)} onClick={() => navigate('/chat')}>
                <span className={styles.sideNavIcon}>●</span>
                Chat
              </button>
              {/* Employee-only: HR reads and answers the same escalations from the HR
                  Inbox above, so a second view of them would just be confusing. */}
              {!isHrAdmin && (
                <button className={cx(styles.sideNavItem, isActive('/my-questions') && styles.active)} onClick={() => navigate('/my-questions')}>
                  <span className={styles.sideNavIcon}>
                    <Bell size={14} />
                  </span>
                  My Questions
                  {state.unreadAnswers > 0 && <span className={styles.navBadge}>{state.unreadAnswers}</span>}
                </button>
              )}
              <button className={cx(styles.sideNavItem, isActive('/resources') && styles.active)} onClick={() => navigate('/resources')}>
                <span className={styles.sideNavIcon}>
                  <Folder size={14} />
                </span>
                Resources
              </button>
            </div>

            <div className={styles.recentsBlock}>
              <p className={styles.kicker}>Recents</p>
              <p className={styles.note}>Chats delete after 7 days</p>
              {recentsTop2.length === 0 && <p className={styles.recentsEmpty}>No recent chats</p>}
              {recentsTop2.map((r) => (
                <div className={styles.recent} key={r.id}>
                  <button className={styles.recentLabel} onClick={() => void openRecent(r.id)}>
                    {r.label}
                  </button>
                </div>
              ))}
              <button className={styles.viewAllLink} onClick={() => navigate('/history')}>
                View all in Chat History →
              </button>
            </div>
          </div>

          <button className={cx(styles.sideNavItem, styles.connectHrItem)} onClick={() => navigate('/contact')}>
            <span className={styles.sideNavIcon}>
              <Mail size={14} />
            </span>
            Connect to HR
          </button>

          <div className={styles.footer}>
            {userMenuOpen && (
              <div className={styles.userMenu}>
                <button onClick={handleSignOut}>Sign out</button>
              </div>
            )}
            <button className={styles.userRow} onClick={() => setUserMenuOpen((v) => !v)}>
              <span className={styles.userBadge}>{user.initials}</span>
              <span className={styles.userText}>
                <span className={styles.userName}>{user.name}</span>
                <span className={styles.userRoleSub}>{user.title}</span>
              </span>
            </button>
          </div>
        </>
      ) : (
        <>
          <button className={styles.iconBtn} onClick={newChat} title="New chat" aria-label="New chat">
            +
          </button>
          {/* Same ordering as the expanded sidebar: HR tools first for admins. */}
          {isHrAdmin && (
            <>
              <button
                className={cx(styles.iconBtn, styles.ghost, isActive('/admin') && styles.active)}
                onClick={() => navigate('/admin')}
                title="Dashboard"
                aria-label="Dashboard"
              >
                <LayoutGrid size={16} />
              </button>
              <button
                className={cx(styles.iconBtn, styles.ghost, isActive('/admin/documents') && styles.active)}
                onClick={() => navigate('/admin/documents')}
                title="Document Management"
                aria-label="Document Management"
              >
                <FileText size={16} />
              </button>
              <button
                className={cx(styles.iconBtn, styles.ghost, isActive('/admin/inbox') && styles.active)}
                onClick={() => navigate('/admin/inbox')}
                title="HR Inbox"
                aria-label="HR Inbox"
              >
                <Inbox size={16} />
                {state.pendingRequests > 0 && <span className={styles.railDot} />}
              </button>
            </>
          )}
          {!isHrAdmin && (
            <button
              className={cx(styles.iconBtn, styles.ghost, isActive('/my-questions') && styles.active)}
              onClick={() => navigate('/my-questions')}
              title="My Questions"
              aria-label="My Questions"
            >
              <Bell size={16} />
              {state.unreadAnswers > 0 && <span className={styles.railDot} />}
            </button>
          )}
          <button
            className={cx(styles.iconBtn, styles.ghost, isActive('/resources') && styles.active)}
            onClick={() => navigate('/resources')}
            title="Resources"
            aria-label="Resources"
          >
            <Folder size={16} />
          </button>
          <div className={styles.spacer} />
          <button className={cx(styles.iconBtn, styles.ghost, styles.connectHr)} onClick={() => navigate('/contact')} title="Connect to HR" aria-label="Connect to HR">
            <Mail size={16} />
          </button>
          <div className={styles.footer}>
            {userMenuOpen && (
              <div className={styles.userMenu}>
                <button onClick={handleSignOut}>Sign out</button>
              </div>
            )}
            <button className={styles.iconBtn} style={{ fontSize: 12 }} onClick={() => setUserMenuOpen((v) => !v)} title={user.name} aria-label="Account menu">
              {user.initials}
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
