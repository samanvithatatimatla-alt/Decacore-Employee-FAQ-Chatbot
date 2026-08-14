import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Search } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import panel from '../components/common/panel.module.css';
import styles from './ChatHistoryPage.module.css';
import type { HistoryGroupLabel } from '../types';

const GROUP_ORDER: HistoryGroupLabel[] = ['Today', 'Yesterday', 'This week'];

export default function ChatHistoryPage() {
  const { state, dispatch, restoreConversation } = useAppState();
  const navigate = useNavigate();
  const { conversations, search } = state.history;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => !q || c.label.toLowerCase().includes(q));
  }, [conversations, search]);

  const groups = GROUP_ORDER.map((label) => ({
    label,
    items: filtered.filter((c) => c.group === label),
  })).filter((g) => g.items.length > 0);

  const openConversation = async (convId: number) => {
    // Messages are not included in the conversation list, only in the detail
    // response, so they have to be fetched before the thread can render.
    await restoreConversation(convId);
    navigate('/chat');
  };

  return (
    <div className={panel.panel}>
      <h1 className={panel.title}>Chat History</h1>
      <p className={panel.sub} style={{ marginTop: 4 }}>
        Conversations are automatically deleted after 7 days.
      </p>

      {conversations.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <MessageSquare size={28} />
          </div>
          <p className={styles.emptyTitle}>No conversations yet</p>
          <p className={styles.emptyDesc}>Questions you ask the assistant will show up here.</p>
          <button className={styles.emptyBtn} onClick={() => navigate('/chat')}>
            Start a new chat
          </button>
        </div>
      ) : (
        <>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <Search size={15} />
            </span>
            <input
              className={styles.search}
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => dispatch({ type: 'SET_HISTORY_SEARCH', value: e.target.value })}
            />
          </div>

          {groups.map((g) => (
            <div key={g.label}>
              <p className={panel.sectionLabel}>{g.label}</p>
              {g.items.map((item) => (
                <button className={styles.row} key={item.id} onClick={() => openConversation(item.id)}>
                  <span className={styles.icon}>
                    <MessageSquare size={16} />
                  </span>
                  <span className={styles.info}>
                    <span className={styles.rowTitle}>{item.label}</span>
                  </span>
                  <span className={styles.time}>{item.time}</span>
                  <span className={styles.chevron}>→</span>
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
