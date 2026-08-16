/**
 * Request context for one escalation, plus the reply box.
 *
 * Shows what the employee asked, the note they added, and what QBot answered —
 * HR needs the bot's attempt to know why it failed, and the API already splits the
 * stored message into those three parts.
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import { api, type ApiInboxRequest, type InboxStatus } from '../../api/client';
import styles from './EscalationModal.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const STATUSES: InboxStatus[] = ['New', 'In Progress', 'Resolved'];

interface Props {
  item: ApiInboxRequest;
  onClose: () => void;
  onUpdated: (updated: ApiInboxRequest) => void;
}

export default function EscalationModal({ item, onClose, onUpdated }: Props) {
  const [reply, setReply] = useState(item.hr_response ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<ApiInboxRequest>) => {
    setBusy(true);
    setError(null);
    try {
      onUpdated(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const send = async (resolve: boolean) => {
    if (!reply.trim()) return;
    await run(() => api.respondToEscalation(item.id, reply, resolve));
    if (resolve) onClose();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Escalated question</h2>
            <p className={styles.sub}>
              {item.employee_name ?? 'Unknown employee'}
              {item.employee_department ? ` · ${item.employee_department}` : ''} ·{' '}
              {new Date(item.created_at).toLocaleString()}
            </p>
          </div>
          <button className={styles.iconBtn} onClick={onClose} title="Close" aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.statusRow}>
            {STATUSES.map((s) => (
              <button
                key={s}
                className={cx(styles.statusBtn, item.status === s && styles.active)}
                disabled={busy}
                onClick={() => void run(() => api.setInboxStatus(item.id, s))}
              >
                {s}
              </button>
            ))}
          </div>

          <p className={styles.label}>Question</p>
          <p className={styles.text}>{item.question || item.message}</p>

          {item.employee_note && (
            <>
              <p className={styles.label}>Employee note</p>
              <p className={styles.text}>{item.employee_note}</p>
            </>
          )}

          {item.ai_response && (
            <>
              <p className={styles.label}>What QBot answered</p>
              <p className={cx(styles.text, styles.aiText)}>{item.ai_response}</p>
            </>
          )}

          <p className={styles.label}>Your response</p>
          <textarea
            className={styles.textarea}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write the answer the employee will receive..."
            rows={5}
            maxLength={4000}
          />
          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          <button className={styles.ghostBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={styles.ghostBtn} onClick={() => void send(false)} disabled={busy || !reply.trim()}>
            Save draft
          </button>
          <button className={styles.primaryBtn} onClick={() => void send(true)} disabled={busy || !reply.trim()}>
            {busy ? 'Sending…' : 'Send & resolve'}
          </button>
        </div>
      </div>
    </div>
  );
}
