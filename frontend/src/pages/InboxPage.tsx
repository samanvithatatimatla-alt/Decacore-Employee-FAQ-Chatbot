/**
 * HR inbox for chat escalations.
 *
 * The backend has carried the whole contract for a while — /api/requests/inbox,
 * /{id}/status and /{id}/respond, with the escalation body already split into
 * question / employee note / AI response — but nothing rendered it, so every
 * "Send to HR" landed in the database and was never seen. This is that screen.
 *
 * State lives here rather than in AppStateContext: it is one HR-only page, and the
 * filters hit the server on every change, so there is nothing to share.
 */

import { useCallback, useEffect, useState } from 'react';
import { Inbox, Search } from 'lucide-react';
import { api, type ApiInboxRequest, type InboxStatus } from '../api/client';
import EscalationModal from '../components/admin/EscalationModal';
import panel from '../components/common/panel.module.css';
import styles from './InboxPage.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const TABS: Array<InboxStatus | 'All'> = ['All', 'New', 'In Progress', 'Resolved'];

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

export default function InboxPage() {
  const [tab, setTab] = useState<InboxStatus | 'All'>('All');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<ApiInboxRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.inbox(tab, search);
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the inbox');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  // Debounced: the search box filters server-side, and firing per keystroke would
  // put a request on the wire for every letter of an employee's name.
  useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const open = items.find((i) => i.id === openId) ?? null;

  const applyUpdate = (updated: ApiInboxRequest) => {
    // Patch in place instead of refetching: the tab filter would otherwise make a
    // row vanish under the modal the moment HR resolved it.
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  const newCount = items.filter((i) => i.status === 'New').length;

  return (
    <div className={panel.panel}>
      <div className={styles.header}>
        <h1 className={styles.title}>HR Inbox</h1>
        {newCount > 0 && <span className={styles.headerCount}>{newCount} new</span>}
      </div>
      <p className={panel.sub} style={{ margin: '4px 0 0' }}>
        Questions employees escalated from chat because QBot could not answer them.
      </p>

      <div className={styles.search}>
        <Search size={15} />
        <input
          placeholder="Search by employee or question..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.tabs}>
        {TABS.map((t) => (
          <button key={t} className={cx(styles.tab, tab === t && styles.active)} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.empty}>Loading…</p>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <Inbox size={26} />
          <p className={styles.empty}>
            {search || tab !== 'All' ? 'No escalations match this view.' : 'No escalations yet.'}
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <button className={styles.row} key={item.id} onClick={() => setOpenId(item.id)}>
              <span className={styles.rowMain}>
                <span className={styles.rowQuestion}>{item.question || item.message}</span>
                <span className={styles.rowMeta}>
                  {item.employee_name ?? 'Unknown employee'}
                  {item.employee_department ? ` · ${item.employee_department}` : ''} · {when(item.created_at)}
                </span>
              </span>
              <span className={cx(styles.badge, styles[`badge${item.status.replace(' ', '')}`])}>{item.status}</span>
            </button>
          ))}
        </div>
      )}

      {open && <EscalationModal item={open} onClose={() => setOpenId(null)} onUpdated={applyUpdate} />}
    </div>
  );
}
