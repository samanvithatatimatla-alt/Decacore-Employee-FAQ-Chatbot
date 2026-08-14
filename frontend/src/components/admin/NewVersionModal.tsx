import { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import FileDropField from './FileDropField';
import styles from './modal.module.css';

export default function NewVersionModal({ docId, onClose }: { docId: number; onClose: () => void }) {
  const { state, uploadNewVersion } = useAppState();
  const doc = state.adminDocuments.find((d) => d.id === docId);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;
  const currentVersion = doc.versions.length + 1;
  const nextVersion = currentVersion + 1;

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Re-indexes the policy server-side, so the answer the chatbot gives changes
      // once this returns — worth waiting for rather than closing optimistically.
      await uploadNewVersion(docId, file, summary);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Upload new version</h2>
        <p className={styles.sub}>
          Replacing {doc.name} — currently v{currentVersion}
        </p>
        <div>
          <p className={styles.fieldLabel}>File</p>
          <FileDropField file={file} onChange={setFile} />
        </div>
        <div>
          <p className={styles.fieldLabel} style={{ marginTop: 14 }}>
            What changed? (optional)
          </p>
          <textarea
            className={styles.noteField}
            rows={3}
            placeholder="Describe the update for employees, e.g. remote days increased from one to two per week."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>
        <p className={styles.noteHint}>
          This becomes v{nextVersion} immediately. Employees will see an AI-generated summary of what changed on their homepage. The
          previous version stays accessible in version history.
        </p>
        {error && <p className={styles.noteHint} style={{ color: '#b42318' }}>{error}</p>}
        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className={styles.submit}
            onClick={submit}
            disabled={!file || busy}
            style={!file || busy ? { opacity: 0.5, cursor: 'default' } : undefined}
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
