/**
 * Translates API payloads into the shapes the UI components already expect.
 *
 * The UI was written against numeric ids (`id: number`) while the API uses UUID
 * strings. Rather than retyping every component, each record keeps its numeric id
 * for React keys and local lookups and carries the real `apiId` alongside; anything
 * that calls the API uses `apiId`.
 */

import type {
  AdminDoc,
  Announcement,
  ChatMessage,
  Citation,
  Conversation,
  DocVersion,
  FormDoc,
  HistoryGroupLabel,
  PolicyDoc,
  PolicyUpdate,
  RecentlyViewedDoc,
  TopQuestion,
} from '../types';
import type {
  ApiAnnouncement,
  ApiCitation,
  ApiConversation,
  ApiDocument,
  ApiDocumentVersion,
  ApiForm,
  ApiMessage,
  ApiPolicyUpdate,
  ApiSavedDoc,
  ApiTopQuestion,
} from './client';

/** Stable uuid -> small integer, so React keys stay consistent across refetches. */
const numericIds = new Map<string, number>();
let nextNumericId = 1;

export function numericId(uuid: string): number {
  const existing = numericIds.get(uuid);
  if (existing !== undefined) return existing;
  const id = nextNumericId++;
  numericIds.set(uuid, id);
  return id;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "3h ago" style label for history and recently-viewed rows. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(iso);
}

function historyGroup(iso: string): HistoryGroupLabel {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return 'This week';
}

export function mapCitation(c: ApiCitation): Citation {
  const parts = [c.section, c.page ? `p.${c.page}` : null].filter(Boolean);
  return { name: c.title, ref: parts.length ? parts.join(', ') : undefined };
}

export function mapDocument(d: ApiDocument, favorite: boolean): PolicyDoc {
  const meta = [d.category, d.version, d.effective_date ? `effective ${d.effective_date}` : null]
    .filter(Boolean)
    .join(' · ');
  return {
    id: numericId(d.id),
    apiId: d.id,
    name: d.title,
    meta: meta || d.filename,
    favorite,
    version: Number(String(d.version ?? '1').replace(/[^0-9.]/g, '').split('.')[0]) || 1,
    updatedOn: formatDate(d.effective_date ?? d.approved_at ?? d.uploaded_at),
    previewTitle: d.title,
    // The full text lives in the PDF, which opens through the content endpoint.
    previewBody: '',
  };
}

export function mapForm(f: ApiForm, favorite: boolean): FormDoc {
  return {
    id: numericId(f.id),
    apiId: f.id,
    name: f.title,
    meta: [f.category, f.available ? null : 'Not yet uploaded'].filter(Boolean).join(' · ') || f.filename,
    favorite,
  };
}

export function mapSavedToRecentlyViewed(s: ApiSavedDoc): RecentlyViewedDoc {
  return {
    id: numericId(s.document_id),
    apiId: s.document_id,
    name: s.title,
    time: s.last_viewed_at ? relativeTime(s.last_viewed_at) : 'Viewed recently',
  };
}

export function mapPolicyUpdate(u: ApiPolicyUpdate): PolicyUpdate {
  return {
    id: numericId(u.document_id),
    apiId: u.document_id,
    name: u.title,
    date: formatDate(u.updated_at),
    prevDate: formatDate(u.previous_updated_at),
    summary: u.summary ?? 'Updated.',
    question: `What changed in ${u.title}?`,
    prevBody: '',
  };
}

export function mapMessage(m: ApiMessage): ChatMessage {
  const base = {
    id: numericId(m.id),
    apiId: m.id,
  };
  if (m.role === 'user') {
    return { ...base, role: 'user', text: m.content };
  }
  return {
    ...base,
    role: 'bot',
    body: m.content,
    // Low confidence is what the backend uses to offer escalation, so mirror that
    // in the visual treatment rather than inventing a separate signal.
    kind: m.citations.length === 0 ? 'refuse' : (m.confidence_score ?? 1) < 0.15 ? 'warn' : 'answer',
    tags: m.citations.map((c) => c.title),
    citations: m.citations.map(mapCitation),
    escalated: m.escalated,
  };
}

export function mapConversation(c: ApiConversation, messages: ChatMessage[] = []): Conversation {
  return {
    id: numericId(c.id),
    apiId: c.id,
    label: c.title,
    time: relativeTime(c.last_message_at),
    group: historyGroup(c.last_message_at),
    messages,
  };
}

export function mapAnnouncement(a: ApiAnnouncement): Announcement {
  return {
    id: numericId(a.id),
    date: formatDate(a.published_at),
    headline: a.title,
    detail: a.body,
  };
}

export function mapTopQuestion(q: ApiTopQuestion): TopQuestion {
  return { text: q.question, count: q.count };
}

export function mapAdminDoc(d: ApiDocument, versions: ApiDocumentVersion[] = []): AdminDoc {
  // The UI treats `versions` as prior versions only and derives the live number from
  // the array length, so the current version is filtered out here.
  const prior: DocVersion[] = versions
    .filter((v) => !v.is_current)
    .sort((a, b) => a.version_number - b.version_number)
    .map((v) => ({
      uploadedOn: formatDate(v.effective_date),
      uploadedBy: 'HR',
      previewTitle: v.title,
      previewBody: v.change_summary ?? '',
    }));
  return {
    id: numericId(d.id),
    apiId: d.id,
    name: d.filename,
    uploadedOn: formatDate(d.uploaded_at),
    size: '—',
    previewTitle: d.title,
    previewBody: '',
    versions: prior,
  };
}
