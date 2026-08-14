import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileText, Folder, LayoutGrid, Mail, MessageSquare } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAppState } from '../../context/AppStateContext';
import styles from './Sidebar.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function Sidebar() {
  const { user, signOut } = useAuth();
  const { state, dispatch } = useAppState();
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
            <div className={styles.sideNav}>
              <button className={cx(styles.sideNavItem, isActive('/chat') && styles.active)} onClick={() => navigate('/chat')}>
                <span className={styles.sideNavIcon}>●</span>
                Chat
              </button>
              <button className={cx(styles.sideNavItem, isActive('/history') && styles.active)} onClick={() => navigate('/history')}>
                <span className={styles.sideNavIcon}>
                  <MessageSquare size={14} />
                </span>
                Chat History
              </button>
              <button className={cx(styles.sideNavItem, isActive('/resources') && styles.active)} onClick={() => navigate('/resources')}>
                <span className={styles.sideNavIcon}>
                  <Folder size={14} />
                </span>
                Resources
              </button>
            </div>

            {isHrAdmin && (
              <div className={cx(styles.sideNav, styles.hrToolsGroup)}>
                <p className={styles.sectionLabel}>HR Tools</p>
                <button className={cx(styles.sideNavItem, isActive('/admin/documents') && styles.active)} onClick={() => navigate('/admin/documents')}>
                  <span className={styles.sideNavIcon}>
                    <FileText size={14} />
                  </span>
                  Document Management
                </button>
                <button className={cx(styles.sideNavItem, isActive('/admin') && styles.active)} onClick={() => navigate('/admin')}>
                  <span className={styles.sideNavIcon}>
                    <LayoutGrid size={14} />
                  </span>
                  Dashboard
                </button>
              </div>
            )}

            <div className={styles.recentsBlock}>
              <p className={styles.kicker}>Recents</p>
              <p className={styles.note}>Chats delete after 7 days</p>
              {recentsTop2.length === 0 && <p className={styles.recentsEmpty}>No recent chats</p>}
              {recentsTop2.map((r) => (
                <div className={styles.recent} key={r.id}>
                  <button className={styles.recentLabel} onClick={() => navigate('/history')}>
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
          <button
            className={cx(styles.iconBtn, styles.ghost, isActive('/history') && styles.active)}
            onClick={() => navigate('/history')}
            title="Chat History"
            aria-label="Chat History"
          >
            <MessageSquare size={16} />
          </button>
          <button
            className={cx(styles.iconBtn, styles.ghost, isActive('/resources') && styles.active)}
            onClick={() => navigate('/resources')}
            title="Resources"
            aria-label="Resources"
          >
            <Folder size={16} />
          </button>
          {isHrAdmin && (
            <>
              <button
                className={cx(styles.iconBtn, styles.ghost, isActive('/admin/documents') && styles.active)}
                onClick={() => navigate('/admin/documents')}
                title="Document Management"
                aria-label="Document Management"
              >
                <FileText size={16} />
              </button>
              <button
                className={cx(styles.iconBtn, styles.ghost, isActive('/admin') && styles.active)}
                onClick={() => navigate('/admin')}
                title="Dashboard"
                aria-label="Dashboard"
              >
                <LayoutGrid size={16} />
              </button>
            </>
          )}
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
