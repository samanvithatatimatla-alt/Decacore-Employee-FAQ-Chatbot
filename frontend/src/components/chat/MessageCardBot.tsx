import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Check, ChevronDown, Copy, ExternalLink } from 'lucide-react';
import Avatar from '../common/Avatar';
import type { ChatMessage, Citation } from '../../types';
import { api } from '../../api/client';
import { useAppState } from '../../context/AppStateContext';
import styles from './MessageCardBot.module.css';

function cx(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ');
}

interface Props {
  message: ChatMessage;
  onFollowUp: (text: string) => void;
  /** True while this message is still being streamed; draws the caret. */
  streaming?: boolean;
}

export default function MessageCardBot({ message: m, onFollowUp, streaming }: Props) {
  const navigate = useNavigate();
  const { state, dispatch, openDocumentByApiId } = useAppState();
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const tags = m.tags ?? [];
  // Prefer citation objects: they carry the document id, which is what makes a chip
  // openable. Fall back to plain tag strings for messages that predate citations.
  const sources: Citation[] = m.citations?.length ? m.citations : tags.map((name) => ({ name }));
  const cardClass = m.kind === 'warn' ? styles.warn : m.kind === 'refuse' ? styles.refuse : '';
  const canEscalate = m.escalated || m.kind === 'warn' || m.kind === 'refuse';
  const noPolicyMatch = m.kind === 'refuse' && !sources.length;
  // Citations stay collapsed behind a button until asked for: on a short answer,
  // three chips of document titles took more vertical space than the answer itself.
  const expanded = !!m.sourcesExpanded;

  const handleCopy = () => {
    const text = m.body ?? (m.steps ? m.steps.map((s) => `${s.n}. ${s.text}`).join('\n') : '');
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  /**
   * Sends the question and the bot's answer to HR as a real request.
   *
   * Previously this button only navigated to /contact, which is a static page of phone
   * numbers — nothing was created, the HR inbox never saw the question, and the
   * dashboard's escalated-messages count stayed at zero no matter how many employees
   * pressed it.
   */
  const handleEscalate = async () => {
    const conversationId = state.chat.conversationId;
    if (!conversationId) {
      setSendError('This conversation has not been saved yet. Try again in a moment.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await api.escalate(conversationId, m.apiId);
      dispatch({ type: 'MARK_ESCALATION_SENT', messageId: m.id });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Could not send this to HR.');
    } finally {
      setSending(false);
    }
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

          {m.body && (
            <p className={styles.body}>
              {m.body}
              {streaming && <span className={styles.caret} aria-hidden="true" />}
            </p>
          )}

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

          {sources.length > 0 && (
            <>
              <button
                className={styles.sourcesToggle}
                onClick={() => dispatch({ type: 'TOGGLE_SOURCES', messageId: m.id })}
                aria-expanded={expanded}
                type="button"
              >
                <BookOpen size={12} />
                {expanded ? 'Hide resources' : `Show resources (${sources.length})`}
                <ChevronDown size={12} className={cx(styles.sourcesChevron, expanded && styles.sourcesChevronOpen)} />
              </button>
              {expanded && (
                <div className={styles.tags}>
                  {sources.map((c, i) =>
                    c.documentId ? (
                      <button
                        className={cx(styles.tag, styles.tagLink)}
                        key={i}
                        onClick={() => openDocumentByApiId(c.documentId!)}
                        title={`Open ${c.name}${c.ref ? ` — ${c.ref}` : ''}`}
                        type="button"
                      >
                        {c.name}
                        {c.ref && <span className={styles.tagRef}>{c.ref}</span>}
                        <ExternalLink size={11} />
                      </button>
                    ) : (
                      <span className={styles.tag} key={i}>
                        {c.name}
                      </span>
                    ),
                  )}
                </div>
              )}
            </>
          )}

          {m.extLink && (
            <a className={styles.linkChip} href={m.extLink} target="_blank" rel="noopener noreferrer">
              Open link
              <ExternalLink size={12} />
            </a>
          )}

          {/* After the "no policy matched" line, not before it. On a refusal the chip
              was appearing above the explanation, so the offer arrived before the
              reason for it. */}
          {noPolicyMatch && <p className={styles.noMatch}>No approved company policy matched this request.</p>}

          {m.form?.mode === 'resources' && (
            <div className={styles.hrBtnRow}>
              <button className={styles.formChip} onClick={openInResources}>
                {/* Named, not "Open in Resources" — the citation control right above it
                    reads "Show resources (N)", and two near-identical labels made the
                    form look like one more source rather than a thing to go and fill in. */}
                {m.form.title ? `Open ${m.form.title} →` : 'Open in Resources →'}
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

          {canEscalate && (
            <div className={styles.hrBtnRow}>
              {m.escalationSent ? (
                <p className={styles.noMatch} role="status">
                  Sent to HR. They have your question and this answer, and will follow up.
                </p>
              ) : (
                <>
                  <button className={styles.sendHrBtn} onClick={() => void handleEscalate()} disabled={sending}>
                    {sending ? 'Sending…' : 'Send to HR'}
                  </button>
                  <button className={styles.sendHrBtn} onClick={() => navigate('/contact')}>
                    Contact details
                  </button>
                </>
              )}
              {sendError && (
                <p className={styles.noMatch} role="alert">
                  {sendError}
                </p>
              )}
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
