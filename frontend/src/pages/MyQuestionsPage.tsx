/**
 * The employee's side of the HR inbox.
 *
 * "Send to HR" created a request and HR could answer it, but the reply was only ever
 * readable through /api/requests/inbox, which is HRAdmin-only. The employee who asked
 * got an email if notifications were configured and nothing at all inside the app.
 * This is the missing half.
 */

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { api, type ApiInboxRequest } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useAppState } from '../context/AppStateContext';
import { answered, markAllSeen } from '../utils/seenEscalations';
import panel from '../components/common/panel.module.css';
import styles from './MyQuestionsPage.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

/** Relative for the recent past, absolute once "3 days ago" stops being useful. */
function when(iso: string): string {
  const then = new Date(iso);
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 7) return `${Math.round(mins / (60 * 24))}d ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function MyQuestionsPage() {
  const { user } = useAuth();
  const { state, dispatch } = useAppState();
  const unreadAnswers = state.unreadAnswers;
  const [items, setItems] = useState<ApiInboxRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.myEscalations();
      setItems(res.items);
      setError(null);
      // Opening this page is what "reading" means, so the badge clears here rather
      // than per-row: everything answered is on screen.
      if (user?.email) {
        markAllSeen(res.items, user.email);
        dispatch({ type: 'SET_UNREAD_ANSWERS', count: 0 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your questions');
    } finally {
      setLoading(false);
    }
  }, [user?.email, dispatch]);

  useEffect(() => {
    void load();
  }, [load]);

  // The background poll can turn the badge on while this page is already open, and
  // clicking the nav item then does nothing because the route has not changed. Pull
  // the new reply in directly instead. load() marks everything seen, which resets the
  // count to 0 and stops this from re-running.
  useEffect(() => {
    if (unreadAnswers > 0) void load();
  }, [unreadAnswers, load]);

  const answeredCount = answered(items).length;

  return (
    <div className={panel.panel}>
      <div className={styles.header}>
        <h1 className={styles.title}>My Questions</h1>
        {answeredCount > 0 && <span className={styles.headerCount}>{answeredCount} answered</span>}
      </div>
      <p className={panel.sub} style={{ margin: '4px 0 0' }}>
        Questions you sent to HR from chat, and their replies.
      </p>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <MessageSquare size={26} />
          <p className={styles.empty}>
            You haven't sent any questions to HR yet. When QBot can't answer something, use
            "Send to HR" in the chat and the reply will show up here.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => {
            const reply = (item.hr_response ?? '').trim();
            return (
              <article className={styles.card} key={item.id}>
                <div className={styles.cardHead}>
                  <p className={styles.question}>{item.question || item.message}</p>
                  <span className={cx(styles.badge, styles[`badge${item.status.replace(' ', '')}`])}>
                    {item.status}
                  </span>
                </div>
                <p className={styles.meta}>Sent {when(item.created_at)}</p>

                {item.employee_note && (
                  <p className={styles.note}>
                    <span className={styles.noteLabel}>Your note</span>
                    {item.employee_note}
                  </p>
                )}

                {reply ? (
                  <div className={styles.reply}>
                    <p className={styles.replyLabel}>HR replied</p>
                    <p className={styles.replyBody}>{reply}</p>
                  </div>
                ) : (
                  <p className={styles.waiting}>Waiting on HR — you'll see the reply here.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
