import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Copy, ExternalLink } from 'lucide-react';
import Avatar from '../common/Avatar';
import type { ChatMessage } from '../../types';
import { useAppState } from '../../context/AppStateContext';
import styles from './MessageCardBot.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface Props {
  message: ChatMessage;
  onFollowUp: (text: string) => void;
}

export default function MessageCardBot({ message: m, onFollowUp }: Props) {
  const navigate = useNavigate();
  const { dispatch } = useAppState();
  const [copied, setCopied] = useState(false);

  const cardClass = m.kind === 'warn' ? styles.warn : m.kind === 'refuse' ? styles.refuse : '';
  const canEscalate = m.kind === 'warn' || m.kind === 'refuse';
  const noPolicyMatch = m.kind === 'refuse' && !(m.tags && m.tags.length);
  const tags = m.tags ?? [];
  const expanded = !!m.sourcesExpanded;
  const visibleTags = expanded || tags.length <= 2 ? tags : tags.slice(0, 2);
  const hiddenCount = tags.length - visibleTags.length;

  const handleCopy = () => {
    const text = m.body ?? (m.steps ? m.steps.map((s) => `${s.n}. ${s.text}`).join('\n') : '');
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const openInResources = () => {
    if (m.form?.formId != null) dispatch({ type: 'SET_HIGHLIGHT_FORM', formId: m.form.formId });
    navigate('/resources');
  };

  return (
    <div className={styles.botRow}>
      <Avatar size={36} />
      <div className={styles.botCol}>
        <div className={cx(styles.card, cardClass)}>
          <div className={styles.kicker}>{m.kicker}</div>

          {m.body && <p className={styles.body}>{m.body}</p>}

          {m.steps && (
            <div className={styles.steps}>
              {m.steps.map((s) => (
                <div className={styles.step} key={s.n}>
                  <span className={styles.stepDot}>{s.n}</span>
                  <span className={styles.stepText}>{s.text}</span>
                </div>
              ))}
            </div>
          )}

          {tags.length > 0 && (
            <>
              <div className={styles.tags}>
                {visibleTags.map((t, i) => (
                  <span className={styles.tag} key={i}>
                    {t}
                  </span>
                ))}
              </div>
              {hiddenCount > 0 && (
                <button className={styles.sourcesMore} onClick={() => dispatch({ type: 'TOGGLE_SOURCES', messageId: m.id })}>
                  +{hiddenCount} more sources
                </button>
              )}
              {expanded && tags.length > 2 && (
                <button className={styles.sourcesMore} onClick={() => dispatch({ type: 'TOGGLE_SOURCES', messageId: m.id })}>
                  Show less
                </button>
              )}
            </>
          )}

          {m.extLink && (
            <a className={styles.linkChip} href={m.extLink} target="_blank" rel="noopener noreferrer">
              Open link
              <ExternalLink size={12} />
            </a>
          )}

          {m.form?.mode === 'resources' && (
            <div className={styles.hrBtnRow}>
              <button className={styles.formChip} onClick={openInResources}>
                Open in Resources →
              </button>
            </div>
          )}

          {m.form?.mode === 'external' && (
            <div className={styles.hrBtnRow}>
              <a className={styles.formChip} href={m.form.url} target="_blank" rel="noopener noreferrer">
                Open form ↗
              </a>
            </div>
          )}

          {noPolicyMatch && <p className={styles.noMatch}>No approved company policy matched this request.</p>}

          {canEscalate && (
            <div className={styles.hrBtnRow}>
              <button className={styles.sendHrBtn} onClick={() => navigate('/contact')}>
                Connect to HR
              </button>
            </div>
          )}
        </div>

        <div className={styles.msgActions}>
          <button className={cx(styles.msgActionBtn, copied && styles.active)} onClick={handleCopy} title="Copy" aria-label="Copy">
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>

        {m.followUps && m.followUps.length > 0 && (
          <div className={styles.followups}>
            <p className={styles.followupsLabel}>Follow-up questions</p>
            <div className={styles.followupsRow}>
              {m.followUps.map((q, i) => (
                <button className={styles.followupChip} key={i} onClick={() => onFollowUp(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
