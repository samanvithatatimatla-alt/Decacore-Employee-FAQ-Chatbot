import { useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { formatFileSize } from '../../utils/format';
import styles from './modal.module.css';

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
}

export default function FileDropField({ file, onChange, accept = '.pdf,.doc,.docx' }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const openPicker = () => inputRef.current?.click();

  return (
    <div>
      <input
        ref={inputRef}
        className={styles.hiddenInput}
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div className={styles.filePicked}>
          <span className={styles.fileIcon}>
            <FileText size={17} />
          </span>
          <span className={styles.fileInfo}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
          </span>
          <button type="button" className={styles.fileChange} onClick={openPicker}>
            Change
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`${styles.dropzone} ${dragOver ? styles.dragOver : ''}`}
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = e.dataTransfer.files?.[0];
            if (dropped) onChange(dropped);
          }}
        >
          <span className={styles.dropzoneIcon}>
            <Upload size={20} />
          </span>
          <span className={styles.dropzoneText}>Click to choose a file, or drag and drop</span>
          <span className={styles.dropzoneHint}>PDF, DOC, or DOCX</span>
        </button>
      )}
    </div>
  );
}
