import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Search, Star } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { useAuth } from '../context/AuthContext';
import DocumentModal from '../components/resources/DocumentModal';
import panel from '../components/common/panel.module.css';
import styles from './ResourcesPage.module.css';
import type { ResourceFilter } from '../context/AppStateContext';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function ResourcesPage() {
  const { state, dispatch, sendMessage } = useAppState();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { policies, forms, recentlyViewed, policyUpdates, filter, search, highlightFormId } = state.resources;
  const [modal, setModal] = useState<{ id: number; compare?: boolean } | null>(null);

  useEffect(() => {
    if (highlightFormId == null) return;
    const el = document.getElementById(`form-${highlightFormId}`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => dispatch({ type: 'SET_HIGHLIGHT_FORM', formId: null }), 2500);
    return () => clearTimeout(t);
  }, [highlightFormId, dispatch]);

  const q = search.trim().toLowerCase();
  const matches = (name: string, meta: string) => !q || (name + ' ' + meta).toLowerCase().includes(q);

  const filteredPolicies = useMemo(
    () => policies.filter((p) => (filter === 'all' || filter === 'updates' ? true : p.favorite) && matches(p.name, p.meta)),
    [policies, filter, q],
  );
  const filteredForms = useMemo(
    () => forms.filter((f) => (filter === 'all' || filter === 'updates' ? true : f.favorite) && matches(f.name, f.meta)),
    [forms, filter, q],
  );

  const showRecentlyViewed = filter === 'all' && !q;
  const noFavPolicies = filter === 'favorites' && !policies.some((p) => p.favorite);
  const noFavForms = filter === 'favorites' && !forms.some((f) => f.favorite);
  const noResults = !!q && filteredPolicies.length === 0 && filteredForms.length === 0;

  const setTab = (f: ResourceFilter) => dispatch({ type: 'SET_RESOURCE_FILTER', filter: f });

  const askAboutUpdate = (question: string) => {
    sendMessage(question);
    navigate('/chat');
  };

  return (
    <div className={panel.panel}>
      <h1 className={panel.title}>Resources</h1>
      <p className={panel.sub} style={{ margin: '4px 0 0' }}>
        Documents shown are scoped to your role and access permissions{user ? ` — ${user.title}` : ''}.
      </p>

      <div className={styles.search}>
        <Search size={15} />
        <input
          placeholder="Search policies and forms..."
          value={search}
          onChange={(e) => dispatch({ type: 'SET_RESOURCE_SEARCH', value: e.target.value })}
        />
      </div>

      <div className={styles.tabs}>
        <button className={cx(styles.tab, filter === 'all' && styles.active)} onClick={() => setTab('all')}>
          All
        </button>
        <button className={cx(styles.tab, filter === 'favorites' && styles.active)} onClick={() => setTab('favorites')}>
          Favorites
        </button>
        <button className={cx(styles.tab, filter === 'updates' && styles.active)} onClick={() => setTab('updates')}>
          Recently Updated Policies
        </button>
      </div>

      {filter === 'updates' ? (
        <>
          <p className={panel.sub} style={{ margin: '0 0 14px' }}>
            AI-generated summaries of what changed.
          </p>
          <div className={styles.updates}>
            {policyUpdates.map((u) => (
              <div className={styles.updateCard} key={u.id}>
                <div className={styles.updateHead}>
                  <p className={styles.updateName}>{u.name}</p>
                  <span className={styles.updateDate}>Updated {u.date}</span>
                </div>
                <p className={styles.updateSummary}>{u.summary}</p>
                <div className={styles.updateActions}>
                  <button className={styles.updateLink} onClick={() => askAboutUpdate(u.question)}>
                    Ask about this →
                  </button>
                  <button className={styles.updateLink} onClick={() => setModal({ id: u.id, compare: true })}>
                    Compare versions →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {showRecentlyViewed && recentlyViewed.length > 0 && (
            <>
              <p className={panel.sectionLabel} style={{ marginTop: 4 }}>
                Recently viewed
              </p>
              <div className={styles.recentGrid}>
                {recentlyViewed.slice(0, 3).map((rv) => (
                  <button className={styles.recentCard} key={rv.id} onClick={() => setModal({ id: rv.id })}>
                    <span className={styles.recentName}>{rv.name}</span>
                    <span className={styles.recentTime}>{rv.time}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className={panel.sectionLabel}>Policies</p>
          <div className={styles.list}>
            {filteredPolicies.map((p) => (
              <div className={styles.row} key={p.id}>
                <button
                  className={cx(styles.favBtn, p.favorite && styles.on)}
                  onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', key: 'policy', id: p.id })}
                  title="Favorite"
                  aria-label="Favorite"
                >
                  <Star size={15} fill={p.favorite ? 'currentColor' : 'none'} />
                </button>
                <div className={styles.rowInfo}>
                  <div className={styles.rowName}>{p.name}</div>
                  <div className={styles.rowMeta}>{p.meta}</div>
                </div>
                <button className={styles.ghost} onClick={() => setModal({ id: p.id })}>
                  View →
                </button>
              </div>
            ))}
            {noFavPolicies && <p className={styles.emptyNote}>No favorited policies yet</p>}
          </div>

          <p className={panel.sectionLabel}>Forms</p>
          <div className={styles.list}>
            {filteredForms.map((f) => (
              <div className={cx(styles.row, highlightFormId === f.id && styles.highlighted)} key={f.id} id={`form-${f.id}`}>
                <button
                  className={cx(styles.favBtn, f.favorite && styles.on)}
                  onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', key: 'form', id: f.id })}
                  title="Favorite"
                  aria-label="Favorite"
                >
                  <Star size={15} fill={f.favorite ? 'currentColor' : 'none'} />
                </button>
                <div className={styles.rowInfo}>
                  <div className={styles.rowName}>{f.name}</div>
                  <div className={styles.rowMeta}>{f.meta}</div>
                </div>
                <a className={styles.ghost} href="#" onClick={(e) => e.preventDefault()}>
                  <Download size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                  Download
                </a>
              </div>
            ))}
            {noFavForms && <p className={styles.emptyNote}>No favorited forms yet</p>}
          </div>

          {noResults && <p className={styles.emptyNote}>No policies or forms match your search.</p>}
        </>
      )}

      {modal && <DocumentModal policyId={modal.id} initialCompare={modal.compare} onClose={() => setModal(null)} />}
    </div>
  );
}
