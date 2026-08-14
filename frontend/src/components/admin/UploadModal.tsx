import { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import FileDropField from './FileDropField';
import styles from './modal.module.css';

export default function UploadModal({ onClose }: { onClose: () => void }) {
  const { uploadDocument } = useAppState();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Upload also categorises and indexes server-side, so this can take a few
      // seconds. Closing straight away would suggest it finished when it had not.
      await uploadDocument(file);
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
        <h2 className={styles.title}>Upload Document</h2>
        <div>
          <p className={styles.fieldLabel}>File</p>
          <FileDropField file={file} onChange={setFile} />
        </div>
        <p className={styles.noteHint}>This document becomes available to all employees immediately upon upload.</p>
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
