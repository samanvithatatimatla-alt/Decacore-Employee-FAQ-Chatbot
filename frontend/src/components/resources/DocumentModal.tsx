import { useEffect, useState } from 'react';
import { FileText, Star, X } from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import styles from './DocumentModal.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface Props {
  policyId: number;
  initialCompare?: boolean;
  onClose: () => void;
}

export default function DocumentModal({ policyId, initialCompare, onClose }: Props) {
  const { state, dispatch, openDocument } = useAppState();
  const policy = state.resources.policies.find((p) => p.id === policyId);
  const update = state.resources.policyUpdates.find((u) => u.id === policyId);
  const [version, setVersion] = useState<'current' | 'prev'>('current');
  const compareMode = !!initialCompare && !!update;

  useEffect(() => {
    if (policy) dispatch({ type: 'MARK_RECENTLY_VIEWED', id: policy.id, name: policy.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  if (!policy) return null;

  const shownTitle = policy.previewTitle;
  // Policy text lives in the PDF itself, which is served through a short-lived SAS
  // URL rather than inlined into the API response, so the modal summarises and
  // hands off to the file instead of rendering body text.
  const shownBody =
    compareMode && version === 'prev'
      ? (update!.prevBody || 'Open the PDF to read the previous version.')
      : [policy.meta, update?.summary].filter(Boolean).join(' — ') ||
        'Open the full policy to read it.';

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerTitleRow}>
            <h2 className={styles.title}>{policy.name}</h2>
          </div>
          <div className={styles.headerActions}>
            <button
              className={cx(styles.iconBtn, styles.favBtn, policy.favorite && styles.on)}
              onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', key: 'policy', id: policy.id })}
              title="Favorite"
              aria-label="Favorite"
            >
              <Star size={16} fill={policy.favorite ? 'currentColor' : 'none'} />
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="Close" aria-label="Close">
              <X size={17} />
            </button>
          </div>
        </div>

        {compareMode && (
          <>
            <div className={styles.versionTabs}>
              <button className={cx(styles.versionTab, version === 'current' && styles.active)} onClick={() => setVersion('current')}>
                Current — {update!.date}
              </button>
              <button className={cx(styles.versionTab, version === 'prev' && styles.active)} onClick={() => setVersion('prev')}>
                Previous — {update!.prevDate}
              </button>
            </div>
            <div className={styles.changedStrip}>
              <span className={styles.changedDot} />
              {update!.summary}
            </div>
          </>
        )}

        <div className={styles.paper}>
          <div className={styles.paperTitle}>{shownTitle}</div>
          <p className={styles.paperBody}>{shownBody}</p>
          <button className={styles.openPdf} style={{ marginTop: 16 }} onClick={() => openDocument(policy.id)} type="button">
            <FileText size={14} />
            Open full PDF
          </button>
        </div>
      </div>
    </div>
  );
}
