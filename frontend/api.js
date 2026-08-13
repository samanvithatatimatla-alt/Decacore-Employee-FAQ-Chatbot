// API client and the translation layer between backend shapes and the vocabulary
// the prototype's markup expects (Pending/Approved/Rejected, "All Employees",
// "Remote Work Policy — Sec. 3.2, p.7", and so on).

// The API is a different origin now that this app deploys to Static Web Apps rather
// than being served by FastAPI. config.js is generated at deploy time; the fallback
// keeps `python -m http.server` style local development working against a local API.
const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || 'http://localhost:8000';
export const apiUrl = (path) => `${API_BASE}${path}`;

// The prototype's "Dev only" role switch offers exactly these two identities, so the
// port keeps two. Both are seeded users; AUTH_MODE=dev accepts them by header.
export const PERSONAS = {
  employee: { label: 'Employee', email: 'marietta.baudone@gmail.com' },
  hr_admin: { label: 'HR Admin', email: 'hr.admin@bluepeak.example' },
};

let identity = PERSONAS.employee.email;

export function setIdentity(email) {
  identity = email;
}
export function getIdentity() {
  return identity;
}

export function authHeaders(extra = {}) {
  // When AUTH_MODE flips to entra this becomes an Authorization: Bearer header and
  // the dev switch in the nav goes away; nothing else in the app changes.
  return new Headers({ 'X-Dev-User-Email': identity, ...extra });
}

export async function api(path, options = {}) {
  const res = await fetch(apiUrl(path), { ...options, headers: authHeaders(options.headers || {}) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

// Category values the backend will accept on PATCH /category. The prototype offered
// its own list ('General', 'Uncategorized'); those would be rejected with a 400, so
// the real vocabulary wins here.
export const CATEGORIES = ['Benefits', 'Leave', 'Payroll', 'Travel', 'Insurance', 'Reimbursements'];

const ROLE_TO_GROUP = { Employee: 'All Employees', Manager: 'Managers', Executive: 'Executive Team' };
const GROUP_TO_ROLE = { 'All Employees': 'Employee', Managers: 'Manager', 'Executive Team': 'Executive' };

export const roleToGroup = (role) => ROLE_TO_GROUP[role] || role;
export const groupToRole = (group) => GROUP_TO_ROLE[group] || null;

export function statusLabel(status) {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

export function statusTagClass(label) {
  if (label === 'Approved') return 'tag-approved';
  if (label === 'Rejected') return 'tag-rejected';
  return 'tag-pending';
}

export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Shapes a DocumentOut into the record the prototype's document table and review
// screen read from.
export function toDocRecord(d) {
  const status = statusLabel(d.status);
  const groups = (d.allowed_roles || []).map(roleToGroup);
  return {
    id: d.id,
    name: d.filename || `${d.title}.pdf`,
    title: d.title,
    category: d.category || 'Uncategorized',
    status,
    tagClass: statusTagClass(status),
    uploadedOn: shortDate(d.uploaded_at),
    decidedOn: shortDate(d.approved_at || d.uploaded_at),
    audience: groups,
    audienceLabel: groups.join(', ') || '—',
    confidence: d.ai_confidence != null ? Math.round(d.ai_confidence * 100) : null,
    allowedRoles: d.allowed_roles || [],
    rejectionComment: d.rejection_comment || '',
    version: d.version || null,
    // The viewer renders the real PDF; these are the fallback headings the
    // prototype's mock page used.
    previewTitle: (d.title || 'Policy').toUpperCase(),
    previewBody: 'Loading document…',
  };
}

export async function documentContentUrl(id) {
  // /content honours role checks and applies the dynamic watermark when it is
  // enabled, so the viewer fetches it as a blob rather than linking straight out.
  const res = await fetch(apiUrl(`/api/documents/${id}/content`), { headers: authHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Unable to open document');
  }
  return URL.createObjectURL(await res.blob());
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

// Target shape is the prototype's "Remote Work Policy — Sec. 3.2, p.7".
// The local retriever does not always find a real section heading: it falls back to
// the document title or to "Page 3", both of which would render as
// "Policy — Sec. Policy, p.1". Those are dropped so only the page number shows.
export function citationLabel(c) {
  const hasSection = c.section && c.section !== c.title && !/^page\s+\d+$/i.test(c.section);
  const parts = [];
  if (hasSection) parts.push(`Sec. ${c.section}`);
  if (c.page != null) parts.push(`p.${c.page}`);
  return parts.length ? `${c.title} — ${parts.join(', ')}` : c.title;
}

// The prototype styles three answer states. The backend reports confidence plus a
// should_escalate flag rather than a state, so derive one: no sources at all reads
// as "not covered", several sources it could not reconcile reads as a conflict.
export function botKind(citations, escalationOffered) {
  if (!escalationOffered) return { kind: 'answer', kicker: 'Answer' };
  if (!citations || citations.length === 0) return { kind: 'refuse', kicker: 'Not Covered by Policy' };
  return { kind: 'warn', kicker: 'Policy Conflict Detected' };
}

// Streams POST /api/chat, invoking handlers as each SSE frame arrives.
export async function streamChat({ message, conversationId }, handlers) {
  const body = { message };
  if (conversationId) body.conversation_id = conversationId;
  const res = await fetch(apiUrl('/api/chat'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
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

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const DAY = 86400000;

// The prototype groups history under Today / Yesterday / This week / Earlier.
export function groupConversations(items) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const buckets = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This week', items: [] },
    { label: 'Earlier', items: [] },
  ];
  for (const c of items) {
    const at = new Date(c.last_message_at);
    // Compare calendar days, not elapsed hours — a conversation at 11pm last night
    // is "Yesterday" even though it is only two hours old.
    const atMidnight = new Date(at);
    atMidnight.setHours(0, 0, 0, 0);
    const daysAgo = Math.round((startOfToday - atMidnight) / DAY);
    const bucket = daysAgo <= 0 ? 0 : daysAgo === 1 ? 1 : daysAgo < 7 ? 2 : 3;
    buckets[bucket].items.push({
      id: c.id,
      label: c.title,
      time: relativeTime(at, daysAgo),
    });
  }
  return buckets.filter((b) => b.items.length);
}

function relativeTime(at, daysAgo) {
  if (daysAgo <= 0) return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return `${daysAgo} days ago`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
