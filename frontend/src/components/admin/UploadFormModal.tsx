import { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import FileDropField from './FileDropField';
import styles from './modal.module.css';

/**
 * Publish a fillable form.
 *
 * Deliberately separate from UploadModal: a form is not a policy document. It is
 * never chunked, embedded, indexed or cited, so there is no category classifier and
 * no permissions field here — it simply appears in Resources for employees to open.
 * Sharing one modal with a "this is a form" checkbox would have hidden that the two
 * take completely different paths through the backend.
 */
export default function UploadFormModal({ onClose, categories }: { onClose: () => void; categories: string[] }) {
  const { uploadForm } = useAppState();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      await uploadForm(file, title.trim() || undefined, category || undefined);
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
        <h2 className={styles.title}>Upload Form</h2>
        <div>
          <p className={styles.fieldLabel}>File</p>
          <FileDropField file={file} onChange={setFile} />
        </div>
        <div>
          <p className={styles.fieldLabel}>Name (optional)</p>
          <input
            className={styles.fieldText}
            value={title}
            placeholder={file ? file.name.replace(/\.pdf$/i, '').replace(/_/g, ' ') : 'Leave Request Form'}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div>
          <p className={styles.fieldLabel}>Category (optional)</p>
          <select className={styles.fieldText} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <p className={styles.noteHint}>
          Forms appear in Resources for employees to download. They are not searched or quoted by the
          chatbot. Uploading a file that matches an existing form replaces that form&rsquo;s file.
        </p>
        {error && (
          <p className={styles.noteHint} style={{ color: '#b42318' }}>
            {error}
          </p>
        )}
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
