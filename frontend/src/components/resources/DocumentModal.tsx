import { useEffect, useState } from 'react';
import { ExternalLink, Star, X } from 'lucide-react';
import { useAppState } from '../../context/AppStateContext';
import { files } from '../../api/client';
import styles from './DocumentModal.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface Props {
  policyId: number;
  initialCompare?: boolean;
  onClose: () => void;
}

/**
 * Reading pane for a policy.
 *
 * This used to render a mock "page": a light slab repeating the title the header
 * already showed, one line of metadata, and a button to go and read the actual
 * document somewhere else. Pressing View therefore never showed the thing you asked
 * to view — it showed a dead end with another click in it, and on the dark theme that
 * slab landed as a bright empty block in the middle of the screen.
 *
 * It now embeds the PDF itself. The URL comes from the same resolver the "open in a
 * tab" path uses: a short-lived SAS URL on Azure, or a blob URL fetched with
 * credentials when storage is local — a bare src would be an unauthenticated
 * navigation and 401 in both cases.
 */
export default function DocumentModal({ policyId, initialCompare, onClose }: Props) {
  const { state, dispatch, openDocument } = useAppState();
  const policy = state.resources.policies.find((p) => p.id === policyId);
  const update = state.resources.policyUpdates.find((u) => u.id === policyId);
  const [version, setVersion] = useState<'current' | 'prev'>('current');
  const compareMode = !!initialCompare && !!update;

  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const apiId = policy?.apiId;

  useEffect(() => {
    if (policy) dispatch({ type: 'MARK_RECENTLY_VIEWED', id: policy.id, name: policy.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  useEffect(() => {
    if (!apiId) return;
    let cancelled = false;
    setUrl(null);
    setError(null);
    files
      .documentOpenUrl(apiId)
      .then((resolved) => {
        // The modal may have been closed while the bytes were in flight.
        if (!cancelled) setUrl(resolved);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load this document.');
      });
    return () => {
      cancelled = true;
    };
  }, [apiId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!policy) return null;

  const showingPrevious = compareMode && version === 'prev';

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={policy.name}
      >
        <div className={styles.header}>
          <div className={styles.headerTitleRow}>
            <h2 className={styles.title}>{policy.name}</h2>
            <span className={styles.subtitle}>{policy.meta}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              className={cx(styles.iconBtn, styles.favBtn, policy.favorite && styles.on)}
              onClick={() => dispatch({ type: 'TOGGLE_FAVORITE', key: 'policy', id: policy.id })}
              title="Favourite"
              aria-label="Favourite"
            >
              <Star size={16} fill={policy.favorite ? 'currentColor' : 'none'} />
            </button>
            <button
              className={styles.iconBtn}
              onClick={() => openDocument(policy.id)}
              title="Open in a new tab"
              aria-label="Open in a new tab"
            >
              <ExternalLink size={16} />
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="Close" aria-label="Close">
              <X size={17} />
            </button>
          </div>
        </div>

        {compareMode && (
          <>
            <div className={styles.versionTabs}>
              <button
                className={cx(styles.versionTab, version === 'current' && styles.active)}
                onClick={() => setVersion('current')}
              >
                Current — {update!.date}
              </button>
              <button
                className={cx(styles.versionTab, version === 'prev' && styles.active)}
                onClick={() => setVersion('prev')}
              >
                Previous — {update!.prevDate}
              </button>
            </div>
            <div className={styles.changedStrip}>
              <span className={styles.changedDot} />
              {update!.summary}
            </div>
          </>
        )}

        <div className={styles.viewer}>
          {showingPrevious ? (
            /* Only the current file is stored as a document; the previous version is
               represented by its change summary. */
            <div className={styles.notice}>
              <p>{update!.prevBody || 'The previous version is described by the change summary above.'}</p>
            </div>
          ) : error ? (
            <div className={styles.notice}>
              <p>{error}</p>
              <button className={styles.openPdf} onClick={() => openDocument(policy.id)} type="button">
                <ExternalLink size={14} />
                Try opening it in a new tab
              </button>
            </div>
          ) : url ? (
            <iframe className={styles.frame} src={url} title={policy.name} />
          ) : (
            <div className={styles.notice}>
              <p className={styles.loading}>Loading document…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
