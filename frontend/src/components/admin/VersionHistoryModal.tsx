import { useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import styles from './modal.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface ViewingVersion {
  version: number;
  uploadedOn: string;
  uploadedBy: string;
  previewTitle: string;
  previewBody: string;
}

export default function VersionHistoryModal({ docId, onClose }: { docId: number; onClose: () => void }) {
  const { state } = useAppState();
  const doc = state.adminDocuments.find((d) => d.id === docId);
  const [viewing, setViewing] = useState<ViewingVersion | null>(null);
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  if (!doc) return null;

  const currentVersionNum = doc.versions.length + 1;
  const rows: ViewingVersion[] = [
    { version: currentVersionNum, uploadedOn: doc.uploadedOn, uploadedBy: 'Maya Sharma', previewTitle: doc.previewTitle, previewBody: doc.previewBody },
    ...doc.versions
      .slice()
      .reverse()
      .map((v, i) => ({ version: doc.versions.length - i, uploadedOn: v.uploadedOn, uploadedBy: v.uploadedBy, previewTitle: v.previewTitle, previewBody: v.previewBody })),
  ];

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={`${styles.card} ${styles.wide}`} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.title}>Version history</h2>
        <p className={styles.sub}>{doc.name}</p>
        <div className={styles.verList}>
          <div className={`${styles.verRow} ${styles.verHead}`}>
            <span>Version</span>
            <span>Uploaded</span>
            <span>Uploaded by</span>
            <span></span>
          </div>
          {rows.map((v) => (
            <div className={styles.verRow} key={v.version}>
              <span className={styles.verNum}>v{v.version}</span>
              <span className={styles.verMuted}>{v.uploadedOn}</span>
              <span className={styles.verMuted}>{v.uploadedBy}</span>
              <span>
                {v.version === currentVersionNum ? (
                  <span className={styles.verMuted}>Current</span>
                ) : (
                  <button
                    className={styles.rowLink}
                    onClick={() => {
                      setViewerFullscreen(false);
                      setViewing(v);
                    }}
                  >
                    View →
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {viewing && (
        <div
          className={styles.backdrop}
          onClick={(e) => {
            e.stopPropagation();
            setViewing(null);
          }}
        >
          <div className={cx(styles.card, viewerFullscreen && styles.cardFullscreen)} onClick={(e) => e.stopPropagation()}>
            <div className={styles.viewHeaderRow}>
              <div>
                <h2 className={styles.title}>
                  {doc.name} — v{viewing.version}
                </h2>
                <p className={styles.sub}>
                  Uploaded {viewing.uploadedOn} by {viewing.uploadedBy}
                </p>
              </div>
              <button
                className={styles.fullscreenBtn}
                onClick={() => setViewerFullscreen((v) => !v)}
                title="Toggle full screen"
                aria-label="Toggle full screen"
              >
                {viewerFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
            <div className={styles.paper}>
              <div className={styles.paperTitle}>{viewing.previewTitle}</div>
              <p className={styles.paperBody}>{viewing.previewBody}</p>
            </div>
            <div className={styles.actions}>
              <button className={styles.cancel} onClick={() => setViewing(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
