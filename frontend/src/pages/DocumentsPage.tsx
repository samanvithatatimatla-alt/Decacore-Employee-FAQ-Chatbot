import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, MoreVertical, Plus, Search } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { api, ApiError } from '../api/client';
import UploadModal from '../components/admin/UploadModal';
import VersionHistoryModal from '../components/admin/VersionHistoryModal';
import NewVersionModal from '../components/admin/NewVersionModal';
import panel from '../components/common/panel.module.css';
import styles from './DocumentsPage.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const ALL = 'All';
const UNCATEGORISED = 'Uncategorised';

export default function DocumentsPage() {
  const { state, deleteDocument, refresh } = useAppState();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionHistoryId, setVersionHistoryId] = useState<number | null>(null);
  const [newVersionId, setNewVersionId] = useState<number | null>(null);
  const [category, setCategory] = useState(ALL);
  const [known, setKnown] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [relabelId, setRelabelId] = useState<number | null>(null);

  // The category list comes from the API, not from the documents, so a category HR
  // has created but not filed anything under still gets a tab. Documents carrying a
  // category the list has lost are unioned in below so nothing becomes unreachable.
  const loadCategories = useCallback(async () => {
    const res = await api.documentCategories().catch(() => ({ items: [] }));
    setKnown(res.items.map((c) => c.name));
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // Confirmations are transient; an error stays until the next action replaces it
  // would be worse here, since every one of them is recoverable by trying again.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const addCategory = async () => {
    const name = window.prompt('New category name');
    if (!name?.trim()) return;
    try {
      const res = await api.addDocumentCategory(name.trim());
      await loadCategories();
      setCategory(res.name);
      // "Already exists as X" is not an error — HR asked for the category to exist
      // and it does. Saying so is friendlier than a red banner.
      setNotice(res.created ? `Added "${res.name}".` : `That already exists as "${res.name}".`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not add that category.');
    }
  };

  const relabel = async (docApiId: string | undefined, next: string) => {
    setRelabelId(null);
    if (!docApiId) return;
    try {
      await api.setDocumentCategory(docApiId, next);
      await refresh();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not change the category.');
    }
  };

  // Built from the documents themselves rather than a hard-coded list, so a category
  // that only exists in the data — or a new one added later — gets a tab without a
  // code change. Counts come along because an empty tab is worth seeing before you
  // click it.
  const tabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of state.adminDocuments) {
      const key = doc.category?.trim() || UNCATEGORISED;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const name of known) if (!counts.has(name)) counts.set(name, 0);
    const named = [...counts.entries()]
      .filter(([name]) => name !== UNCATEGORISED)
      .sort((a, b) => a[0].localeCompare(b[0]));
    // Uncategorised last, and only when something is actually in it.
    if (counts.has(UNCATEGORISED)) named.push([UNCATEGORISED, counts.get(UNCATEGORISED)!]);
    return [[ALL, state.adminDocuments.length] as const, ...named];
  }, [state.adminDocuments, known]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.adminDocuments.filter((d) => {
      const inCategory =
        category === ALL || (d.category?.trim() || UNCATEGORISED) === category;
      return inCategory && (!q || d.name.toLowerCase().includes(q));
    });
  }, [state.adminDocuments, search, category]);

  return (
    <div className={panel.panel}>
      <div className={styles.header}>
        <h1 className={styles.title}>Document Management</h1>
        <button className={styles.uploadBtn} onClick={() => setUploadOpen(true)}>
          Upload Document
        </button>
      </div>

      <div className={styles.search}>
        <Search size={15} />
        <input placeholder="Search document names..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className={styles.tabs} role="tablist">
        {tabs.map(([name, count]) => (
          <button
            key={name}
            className={cx(styles.tab, category === name && styles.tabActive)}
            onClick={() => setCategory(name)}
            role="tab"
            aria-selected={category === name}
          >
            {name}
            <span className={styles.tabCount}>{count}</span>
          </button>
        ))}
        <button className={styles.addTab} onClick={() => void addCategory()} title="Add category">
          <Plus size={13} />
          Add category
        </button>
      </div>

      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      <div className={styles.table}>
        <div className={styles.tableHead}>
          <span>Document Name</span>
          <span>Uploaded On</span>
          <span style={{ textAlign: 'right' }}>Action</span>
        </div>
        {filtered.map((doc) => (
          <div className={styles.tableRow} key={doc.id}>
            <span className={styles.nameCell}>
              <FileText size={14} />
              <span>{doc.name}</span>
            </span>
            <span className={styles.dateCell}>{doc.uploadedOn}</span>
            <span className={styles.actionCell}>
              <button
                className={styles.kebabBtn}
                onClick={() => setMenuOpenId(menuOpenId === doc.id ? null : doc.id)}
                title="Actions"
                aria-label="Actions"
              >
                <MoreVertical size={15} />
              </button>
              {menuOpenId === doc.id && (
                <div className={styles.kebabMenu}>
                  <button
                    className={styles.kebabItem}
                    onClick={() => {
                      setMenuOpenId(null);
                      navigate(`/admin/documents/${doc.id}`);
                    }}
                  >
                    View document
                  </button>
                  <button
                    className={styles.kebabItem}
                    onClick={() => {
                      setMenuOpenId(null);
                      setRelabelId(doc.id);
                    }}
                  >
                    Change category
                  </button>
                  <button
                    className={styles.kebabItem}
                    onClick={() => {
                      setMenuOpenId(null);
                      setVersionHistoryId(doc.id);
                    }}
                  >
                    Version history
                  </button>
                  <button
                    className={styles.kebabItem}
                    onClick={() => {
                      setMenuOpenId(null);
                      setNewVersionId(doc.id);
                    }}
                  >
                    Upload new version
                  </button>
                  <div className={styles.kebabDivider} />
                  <button
                    className={`${styles.kebabItem} ${styles.danger}`}
                    onClick={() => {
                      setMenuOpenId(null);
                      void deleteDocument(doc.id);
                    }}
                  >
                    Remove document
                  </button>
                </div>
              )}
            </span>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className={styles.empty}>
            {search.trim()
              ? `No documents match your search${category === ALL ? '' : ` in ${category}`}.`
              : `No documents in ${category}.`}
          </div>
        )}
      </div>

      {menuOpenId !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 15 }} onClick={() => setMenuOpenId(null)} />
      )}

      {relabelId !== null && (() => {
        const doc = state.adminDocuments.find((d) => d.id === relabelId);
        if (!doc) return null;
        return (
          <div className={styles.pickerBackdrop} onClick={() => setRelabelId(null)}>
            <div className={styles.picker} onClick={(e) => e.stopPropagation()}>
              <p className={styles.pickerTitle}>Change category</p>
              <p className={styles.pickerDoc}>{doc.name}</p>
              <div className={styles.pickerList}>
                {known.map((name) => (
                  <button
                    key={name}
                    className={cx(styles.pickerItem, doc.category === name && styles.pickerItemActive)}
                    onClick={() => void relabel(doc.apiId, name)}
                  >
                    {name}
                    {doc.category === name && <span className={styles.pickerCurrent}>current</span>}
                  </button>
                ))}
              </div>
              <button className={styles.pickerCancel} onClick={() => setRelabelId(null)}>
                Cancel
              </button>
            </div>
          </div>
        );
      })()}

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
      {versionHistoryId !== null && <VersionHistoryModal docId={versionHistoryId} onClose={() => setVersionHistoryId(null)} />}
      {newVersionId !== null && <NewVersionModal docId={newVersionId} onClose={() => setNewVersionId(null)} />}
    </div>
  );
}
