// API client and the translation between backend shapes and the vocabulary the
// QBot markup expects.

// The API is a different origin now that this app deploys to Static Web Apps rather
// than being served by FastAPI. config.js is generated at deploy time; the fallback
// keeps `python -m http.server` style local development working against a local API.
import { accessToken, entraEnabled } from './auth.js';

const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || 'http://localhost:8000';
export const apiUrl = (path) => `${API_BASE}${path}`;

// The "Dev only" role switch offers exactly these two identities, matching the
// prototype. Both are seeded users; AUTH_MODE=dev accepts them by header.
export const PERSONAS = {
  employee: { label: 'Employee', email: 'marietta.baudone@gmail.com' },
  hr_admin: { label: 'HR Admin', email: 'hr.admin@bluepeak.example' },
};

let identity = PERSONAS.employee.email;

export const setIdentity = (email) => {
  identity = email;
};

export async function authHeaders(extra = {}) {
  // With Entra configured every request carries a real access token. Without it the
  // dev header is used, which is what AUTH_MODE=dev on the backend expects. This is
  // the only place the two modes differ.
  if (entraEnabled()) {
    const token = await accessToken();
    if (token) return new Headers({ Authorization: `Bearer ${token}`, ...extra });
  }
  return new Headers({ 'X-Dev-User-Email': identity, ...extra });
}

export async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), { ...options, headers: await authHeaders(options.headers || {}) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const DAY = 86400000;

function relativeDay(value) {
  const at = new Date(value);
  const midnight = new Date(at);
  midnight.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((today - midnight) / DAY);
  if (daysAgo <= 0) return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return `${daysAgo} days ago`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function relativeViewed(value) {
  if (!value) return 'Viewed recently';
  const at = new Date(value);
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'Viewed just now';
  if (mins < 60) return `Viewed ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Viewed ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'Viewed yesterday' : `Viewed ${days} days ago`;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

// Every upload is readable by all three employee-facing roles: the final design
// dropped the access picker, and the upload modal promises the document is
// "available to all employees immediately".
export const DEFAULT_PERMISSIONS = 'Employee,Manager,Executive';

export function toDocRecord(d) {
  return {
    id: d.id,
    name: d.filename || `${d.title}.pdf`,
    title: d.title,
    category: d.category || 'Uncategorized',
    status: d.status,
    uploadedOn: shortDate(d.uploaded_at),
    version: d.version || null,
    previewTitle: (d.title || 'Policy').toUpperCase(),
  };
}

export const listDocuments = () => api('/api/documents');
export const listUpdates = () => api('/api/documents/updates');
export const listVersions = (id) => api(`/api/documents/${id}/versions`);
export const deleteDocument = (id) => api(`/api/documents/${id}`, { method: 'DELETE' });

export function uploadDocument(file, title) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('permissions', DEFAULT_PERMISSIONS);
  if (title) fd.append('title', title);
  return api('/api/documents', { method: 'POST', body: fd });
}

export function uploadVersion(id, file, changeSummary) {
  const fd = new FormData();
  fd.append('file', file);
  if (changeSummary) fd.append('change_summary', changeSummary);
  return api(`/api/documents/${id}/versions`, { method: 'POST', body: fd });
}

// /content honours role checks and applies the dynamic watermark when it is
// enabled, so the viewer fetches it as a blob rather than linking straight out.
async function blobUrl(path) {
  const res = await fetch(apiUrl(path), { headers: await authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Unable to open document');
  }
  return URL.createObjectURL(await res.blob());
}

export const documentContentUrl = (id) => blobUrl(`/api/documents/${id}/content`);
export const versionContentUrl = (id, n) => blobUrl(`/api/documents/${id}/versions/${n}/content`);
export const formContentUrl = (id) => blobUrl(`/api/forms/${id}/content`);

// ---------------------------------------------------------------------------
// Announcements, forms, favourites
// ---------------------------------------------------------------------------

export const listAnnouncements = () => api('/api/announcements');
export const listForms = () => api('/api/forms');
export const listFavorites = () => api('/api/favorites');
export const addFavorite = (id) => api(`/api/favorites/${id}`, { method: 'PUT' });
export const removeFavorite = (id) => api(`/api/favorites/${id}`, { method: 'DELETE' });
export const listRecentlyViewed = () => api('/api/recently-viewed');
export const noteViewed = (id) => api(`/api/recently-viewed/${id}`, { method: 'POST' });

// ---------------------------------------------------------------------------
// HR inbox
// ---------------------------------------------------------------------------

export function listInbox({ status, q } = {}) {
  const params = new URLSearchParams();
  if (status && status !== 'all') params.set('status', status);
  if (q) params.set('q', q);
  const query = params.toString();
  return api(`/api/requests/inbox${query ? `?${query}` : ''}`);
}

export const setInboxStatus = (id, status) => api(`/api/requests/${id}/status`, json('POST', { status }));
export const respondToRequest = (id, response, resolve = false) =>
  api(`/api/requests/${id}/respond`, json('POST', { response, resolve }));

export const inboxTagClass = (status) =>
  status === 'New' ? 'tag-new' : status === 'In Progress' ? 'tag-progress' : 'tag-resolved';

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function citationLabel(c) {
  // Target shape is "Remote Work Policy — Sec. 3.2, p.7". The local retriever does
  // not always find a real section heading: it falls back to the document title or
  // to "Page 3", both of which would render as "Policy — Sec. Policy, p.1".
  const hasSection = c.section && c.section !== c.title && !/^page\s+\d+$/i.test(c.section);
  const parts = [];
  if (hasSection) parts.push(`Sec. ${c.section}`);
  if (c.page != null) parts.push(`p.${c.page}`);
  return parts.length ? `${c.title} — ${parts.join(', ')}` : c.title;
}

// The prototype styles three answer states. The backend reports confidence plus a
// should_escalate flag rather than a state, so derive one: no sources at all reads
// as "not covered", several it could not reconcile reads as a conflict.
export function botKind(citations, escalationOffered) {
  if (!escalationOffered) return { kind: 'answer', kicker: 'Answer' };
  if (!citations || citations.length === 0) return { kind: 'refuse', kicker: 'Not Covered by Policy' };
  return { kind: 'warn', kicker: 'Policy Conflict Detected' };
}

export async function streamChat({ message, conversationId }, handlers) {
  const body = { message };
  if (conversationId) body.conversation_id = conversationId;
  const res = await fetch(apiUrl('/api/chat'), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Chat failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() || '';
    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const raw = frame.match(/^data: (.+)$/m)?.[1];
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (event === 'meta') handlers.onMeta?.(data);
      else if (event === 'delta') handlers.onDelta?.(data);
      else if (event === 'done') handlers.onDone?.(data);
    }
  }
}

export const escalateChat = (conversationId, assistantMessageId, note) =>
  api('/api/chat/escalate', json('POST', {
    conversation_id: conversationId,
    assistant_message_id: assistantMessageId || null,
    note: note || null,
  }));

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const listConversations = () => api('/api/conversations');
export const getConversation = (id) => api(`/api/conversations/${id}`);

// The prototype groups history under Today / Yesterday / This week / Earlier.
export function groupConversations(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buckets = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Earlier', items: [] },
  ];
  for (const c of items) {
    const at = new Date(c.last_message_at);
    const midnight = new Date(at);
    midnight.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((today - midnight) / DAY);
    const bucket = daysAgo <= 0 ? 0 : daysAgo === 1 ? 1 : daysAgo < 7 ? 2 : 3;
    buckets[bucket].items.push({ id: c.id, label: c.title, time: relativeDay(c.last_message_at) });
  }
  return buckets.filter((b) => b.items.length);
}

export const listFaq = () => api('/api/faq/top');
export const getMe = () => api('/api/me');
export const getMetrics = () => api('/api/dashboard/metrics');
export const getCharts = () => api('/api/dashboard/charts');
