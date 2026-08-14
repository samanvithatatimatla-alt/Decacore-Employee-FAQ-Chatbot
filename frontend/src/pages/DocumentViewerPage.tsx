import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, FileText, Maximize, Minimize } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import panel from '../components/common/panel.module.css';
import styles from './DocumentViewerPage.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export default function DocumentViewerPage() {
  const { id } = useParams();
  const { state } = useAppState();
  const navigate = useNavigate();
  const [fullscreen, setFullscreen] = useState(false);

  const doc = state.adminDocuments.find((d) => d.id === Number(id));

  if (!doc) {
    return (
      <div className={panel.panel}>
        <button className={styles.backLink} onClick={() => navigate('/admin/documents')}>
          ← Back to Documents
        </button>
        <p className={panel.sub}>Document not found.</p>
      </div>
    );
  }

  return (
    <div className={panel.panel} style={{ flex: 1 }}>
      <button className={styles.backLink} onClick={() => navigate('/admin/documents')}>
        ← Back to Documents
      </button>

      <div className={styles.header}>
        <span className={styles.icon}>
          <FileText size={20} />
        </span>
        <div>
          <h1 className={styles.title}>{doc.name}</h1>
          <p className={styles.meta}>
            Uploaded {doc.uploadedOn} · {doc.size}
          </p>
        </div>
      </div>

      <div className={cx(styles.viewer, fullscreen && styles.fullscreen)}>
        <div className={styles.toolbar}>
          <span className={styles.filename}>
            <FileText size={14} />
            {doc.name}
          </span>
          <span className={styles.toolbarActions}>
            <button className={styles.toolbarBtn} onClick={() => setFullscreen((v) => !v)} title="Toggle full screen" aria-label="Toggle full screen">
              {fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
            <button className={styles.toolbarBtn} title="Download" aria-label="Download">
              <Download size={15} />
            </button>
          </span>
        </div>
        <div className={styles.page}>
          <div className={styles.pageTitle}>{doc.previewTitle}</div>
          <p className={styles.pageBody}>{doc.previewBody}</p>
        </div>
      </div>
    </div>
  );
}
