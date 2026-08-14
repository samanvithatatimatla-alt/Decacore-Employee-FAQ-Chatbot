import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, MoreVertical, Search } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import UploadModal from '../components/admin/UploadModal';
import VersionHistoryModal from '../components/admin/VersionHistoryModal';
import NewVersionModal from '../components/admin/NewVersionModal';
import panel from '../components/common/panel.module.css';
import styles from './DocumentsPage.module.css';

export default function DocumentsPage() {
  const { state, deleteDocument } = useAppState();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionHistoryId, setVersionHistoryId] = useState<number | null>(null);
  const [newVersionId, setNewVersionId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.adminDocuments.filter((d) => !q || d.name.toLowerCase().includes(q));
  }, [state.adminDocuments, search]);

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
        {filtered.length === 0 && <div className={styles.empty}>No documents match your search.</div>}
      </div>

      {menuOpenId !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 15 }} onClick={() => setMenuOpenId(null)} />
      )}

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
      {versionHistoryId !== null && <VersionHistoryModal docId={versionHistoryId} onClose={() => setVersionHistoryId(null)} />}
      {newVersionId !== null && <NewVersionModal docId={newVersionId} onClose={() => setNewVersionId(null)} />}
    </div>
  );
}
