import { useNavigate } from 'react-router-dom';
import { FileText, Inbox } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import panel from '../components/common/panel.module.css';
import styles from './DashboardPage.module.css';

export default function DashboardPage() {
  const { user } = useAuth();
  const { state, dispatch, mostReferenced } = useAppState();
  const navigate = useNavigate();
  if (!user) return null;

  const topCount = Math.max(...state.topQuestions.map((q) => q.count), 1);

  return (
    <div className={panel.panel}>
      <h1 className={panel.title} style={{ marginBottom: 4 }}>
        Welcome back, {user.firstName}
      </h1>
      <p className={panel.sub} style={{ margin: 0 }}>
        Here's what's happening with QBot today.
      </p>

      <div className={styles.quickLink}>
        <span className={styles.miniIcon}>
          <Inbox size={22} />
        </span>
        <div className={styles.quickLinkText}>
          <h2 className={styles.quickLinkTitle}>HR Inbox</h2>
          <p className={styles.quickLinkSub}>
            {state.pendingRequests > 0
              ? `${state.pendingRequests} escalated question${state.pendingRequests === 1 ? '' : 's'} waiting on a reply`
              : 'Questions employees escalated from chat'}
          </p>
        </div>
        <button className={styles.ghostLink} onClick={() => navigate('/admin/inbox')}>
          Open inbox →
        </button>
      </div>

      <div className={styles.quickLink}>
        <span className={styles.miniIcon}>
          <FileText size={22} />
        </span>
        <div className={styles.quickLinkText}>
          <h2 className={styles.quickLinkTitle}>Document Management</h2>
          <p className={styles.quickLinkSub}>Upload and manage policy documents</p>
        </div>
        <button className={styles.ghostLink} onClick={() => navigate('/admin/documents')}>
          Manage documents →
        </button>
      </div>

      <div className={styles.col}>
        <div className={styles.colHead}>
          <h2 className={panel.sectionLabel} style={{ margin: 0 }}>
            Common Employee Questions
          </h2>
        </div>
        {state.topQuestions.map((q) => (
          <div className={styles.barRow} key={q.text}>
            <span className={styles.barLabel}>{q.text}</span>
            <div className={styles.barTrack}>
              <div className={styles.barFill} style={{ width: `${(q.count / topCount) * 100}%` }} />
            </div>
            <span className={styles.barCount}>{q.count}</span>
          </div>
        ))}
      </div>

      <div className={styles.cols2} style={{ marginTop: 0 }}>
        <div className={styles.col} style={{ marginTop: 20 }}>
          <div className={styles.colHead}>
            <h2 className={panel.sectionLabel} style={{ margin: 0 }}>
              Most Referenced Documents
            </h2>
          </div>
          {mostReferenced.map((m) => (
            <div className={styles.miniRow} key={m.rank}>
              <span className={styles.miniBadge}>{m.rank}</span>
              <span className={styles.miniInfo}>
                <span className={styles.miniTitle}>{m.name}</span>
                <span className={styles.miniSub}>{m.citations} citations</span>
              </span>
            </div>
          ))}
        </div>

        <div className={`${styles.col} ${styles.colStack}`} style={{ marginTop: 20 }}>
          <div className={styles.colHead}>
            <h2 className={panel.sectionLabel} style={{ margin: 0 }}>
              Recently Updated Policies
            </h2>
          </div>
          {state.resources.policyUpdates.slice(0, 3).map((u) => (
            <div className={styles.miniRow} key={u.id}>
              <span className={styles.miniDot} />
              <span className={styles.miniInfo}>
                <span className={styles.miniTitle}>{u.name}</span>
                <span className={styles.miniSub}>Updated {u.date}</span>
              </span>
            </div>
          ))}
          <button
            className={styles.viewAll}
            onClick={() => {
              dispatch({ type: 'SET_RESOURCE_FILTER', filter: 'updates' });
              navigate('/resources');
            }}
          >
            View all updates →
          </button>
        </div>
      </div>
    </div>
  );
}
