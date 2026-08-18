/**
 * Thin typed wrapper over the FastAPI backend.
 *
 * Identity: with Entra configured every request carries `Authorization: Bearer`.
 * Without it the API is running AUTH_MODE=dev and takes the caller's identity from an
 * X-Dev-User-Email header instead. Both paths go through `authHeaders`, so the app
 * never has to know which mode it is in.
 */

import type { Role } from '../types';
import { accessToken, entraEnabled } from '../auth/entra';
import type { EntraConfig } from '../auth/entra';

declare global {
  interface Window {
    APP_CONFIG?: { apiBase?: string; entra?: Partial<EntraConfig> };
  }
}

// config.js is generated at deploy time and loaded before the bundle. The fallback
// keeps `npm run dev` working against a locally running API.
export const API_BASE =
  window.APP_CONFIG?.apiBase?.replace(/\/$/, '') ?? 'http://localhost:8000';

/** Seeded accounts the dev-mode API recognises. */
export const DEV_EMAILS: Record<Role, string> = {
  employee: 'marietta.baudone@gmail.com',
  hr_admin: 'hr.admin@bluepeak.example',
};

let currentEmail: string = DEV_EMAILS.employee;

export function setIdentity(role: Role) {
  currentEmail = DEV_EMAILS[role];
}

async function authHeaders(extra: HeadersInit = {}): Promise<Headers> {
  const h = new Headers(extra);
  if (entraEnabled()) {
    const token = await accessToken();
    if (token) {
      h.set('Authorization', `Bearer ${token}`);
      return h;
    }
    // Entra is configured but no token yet — send neither header. The dev header would
    // be rejected by an entra-mode backend anyway, and sending it would turn a clear
    // 401 into a confusing one.
    return h;
  }
  h.set('X-Dev-User-Email', currentEmail);
  return h;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface RequestInitWithTimeout extends RequestInit {
  /** Fail after this many ms instead of waiting forever. Off by default. */
  timeoutMs?: number;
}

async function request<T>(path: string, init: RequestInitWithTimeout = {}): Promise<T> {
  const { timeoutMs, ...rest } = init;
  // Opt-in rather than global: uploads legitimately run long, because the API chunks,
  // embeds and indexes the PDF before it answers. Only calls that block the UI on
  // their result set a deadline.
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : rest.signal;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...rest, signal, headers: await authHeaders(rest.headers) });
  } catch (e) {
    // A timeout surfaces as a DOMException whose message is "signal timed out" — true,
    // but meaningless to the person reading it on a sign-in screen. 408 is not a status
    // the server sent; it is the closest honest label for "we gave up waiting".
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new ApiError('The server took too long to respond. It may be starting up — try again.', 408);
    }
    throw e;
  }
  if (!res.ok) {
    // FastAPI puts the human-readable reason in `detail`; falling back to the status
    // text alone produces "Bad Request" and hides the actual validation message.
    const detail = await res
      .json()
      .then((b) => (typeof b?.detail === 'string' ? b.detail : null))
      .catch(() => null);
    throw new ApiError(detail ?? `Request failed (${res.status})`, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ types */

interface ListOf<T> {
  items: T[];
  total: number;
}

export interface ApiMe {
  id: number;
  display_name: string;
  email: string;
  role: string;
  department: string | null;
  manager_id: number | null;
  manager_name: string | null;
}

export interface ApiDocument {
  id: string;
  external_document_id: string | null;
  filename: string;
  title: string;
  category: string | null;
  status: string;
  allowed_roles: string[];
  uploaded_at: string;
  approved_at: string | null;
  indexed_at: string | null;
  version: string | null;
  effective_date: string | null;
  source_url: string | null;
}

export interface ApiCategory {
  id: string;
  name: string;
}

export interface ApiForm {
  id: string;
  title: string;
  filename: string;
  category: string | null;
  available: boolean;
}

export interface ApiConversation {
  id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  expires_at: string;
}

export interface ApiCitation {
  document_id: string;
  external_document_id?: string | null;
  title: string;
  section?: string | null;
  page?: number | null;
  version?: string | null;
  effective_date?: string | null;
}

export interface ApiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: ApiCitation[];
  confidence_score: number | null;
  escalated: boolean;
  created_at: string;
}

export interface ApiAnnouncement {
  id: string;
  title: string;
  body: string;
  published_at: string | null;
}

export interface ApiTopQuestion {
  question: string;
  count: number;
}

export interface ApiDocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  filename: string;
  title: string;
  change_summary: string | null;
  is_current: boolean;
  effective_date: string | null;
}

export interface ApiPolicyUpdate {
  document_id: string;
  name: string;
  title: string;
  summary: string | null;
  version_number: number;
  updated_at: string | null;
  previous_version_number: number | null;
  previous_updated_at: string | null;
}

/** Favourites and recently-viewed share a row shape; `kind` separates them. */
export interface ApiSavedDoc {
  document_id: string;
  title: string;
  filename: string;
  kind: string;
  last_viewed_at: string | null;
}

export interface ApiMetrics {
  chat_messages: number;
  escalated_messages: number;
  pending_requests: number;
  approved_documents: number;
}

export interface ApiMostReferenced {
  document_id: string;
  rank: number;
  name: string;
  title: string;
  citations: number;
}

export interface ApiCharts {
  requests_by_status: { label: string; value: number }[];
  documents_by_category: { label: string; value: number }[];
  top_questions: { label: string; value: number }[];
  /** Added after the first integration pass; treated as optional so an older
   *  backend still renders rather than throwing. */
  most_referenced?: ApiMostReferenced[];
}

export type InboxStatus = 'New' | 'In Progress' | 'Resolved';

export interface ApiInboxRequest {
  id: string;
  employee_name?: string | null;
  employee_department?: string | null;
  message: string;
  status: string;
  created_at: string;
  manager_comment?: string | null;
  type?: string | null;
  /** The chat escalation body split back into its three parts by the API. */
  question?: string | null;
  employee_note?: string | null;
  ai_response?: string | null;
  hr_response?: string | null;
}

/* --------------------------------------------------------------- endpoints */

export const api = {
  // Timed out because the whole app waits on this one: it is what turns a signed-in
  // Entra session into a user. The App Service sleeps on the B1 plan, so a cold start
  // can take the better part of a minute — and with no deadline the sign-in screen sat
  // on "Signing in…" for ever, with no error and no way back.
  me: () => request<ApiMe>('/api/me', { timeoutMs: 30000 }),

  documents: () => request<ListOf<ApiDocument>>('/api/documents'),
  documentUpdates: () => request<ListOf<ApiPolicyUpdate>>('/api/documents/updates'),
  documentVersions: (id: string) => request<ListOf<ApiDocumentVersion>>(`/api/documents/${id}/versions`),
  deleteDocument: (id: string) => request<void>(`/api/documents/${id}`, { method: 'DELETE' }),

  uploadDocument: (file: File, permissions = 'Employee,Manager,Executive', title?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('permissions', permissions);
    if (title) form.append('title', title);
    // Content-Type is deliberately unset: the browser adds the multipart boundary,
    // and setting it by hand produces a boundary-less header the server cannot parse.
    return request<ApiDocument>('/api/documents', { method: 'POST', body: form });
  },

  /**
   * Publish a fillable form. Forms are not documents: they are never chunked,
   * indexed or cited, so this is a separate endpoint rather than a flag on upload.
   * Re-uploading a filename that already exists fills in that row's file instead
   * of creating a duplicate.
   */
  uploadForm: (file: File, title?: string, category?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    if (category) form.append('category', category);
    return request<ApiForm>('/api/forms', { method: 'POST', body: form });
  },

  uploadVersion: (id: string, file: File, changeSummary: string) => {
    const form = new FormData();
    form.append('file', file);
    if (changeSummary) form.append('change_summary', changeSummary);
    return request<ApiDocument>(`/api/documents/${id}/versions`, { method: 'POST', body: form });
  },

  documentCategories: () => request<ListOf<ApiCategory>>('/api/documents/categories'),
  addDocumentCategory: (name: string) =>
    request<ApiCategory & { created: boolean }>('/api/documents/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  deleteDocumentCategory: (id: string) =>
    request<void>(`/api/documents/categories/${id}`, { method: 'DELETE' }),
  setDocumentCategory: (id: string, category: string) =>
    request<ApiDocument>(`/api/documents/${id}/category`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category }),
    }),

  forms: () => request<ListOf<ApiForm>>('/api/forms'),

  favorites: () => request<ListOf<ApiSavedDoc>>('/api/favorites'),
  addFavorite: (documentId: string) => request<void>(`/api/favorites/${documentId}`, { method: 'PUT' }),
  removeFavorite: (documentId: string) => request<void>(`/api/favorites/${documentId}`, { method: 'DELETE' }),

  recentlyViewed: () => request<ListOf<ApiSavedDoc>>('/api/recently-viewed'),
  markViewed: (documentId: string) => request<void>(`/api/recently-viewed/${documentId}`, { method: 'POST' }),

  conversations: () => request<ListOf<ApiConversation>>('/api/conversations'),
  conversation: (id: string) => request<ApiConversation & { messages: ApiMessage[] }>(`/api/conversations/${id}`),
  deleteConversation: (id: string) => request<void>(`/api/conversations/${id}`, { method: 'DELETE' }),

  announcements: () => request<ListOf<ApiAnnouncement>>('/api/announcements'),
  topFaq: () => request<ListOf<ApiTopQuestion>>('/api/faq/top'),

  metrics: () => request<ApiMetrics>('/api/dashboard/metrics'),
  charts: () => request<ApiCharts>('/api/dashboard/charts'),
  inbox: (status?: string, q?: string) => {
    const params = new URLSearchParams();
    if (status && status !== 'All') params.set('status', status);
    if (q?.trim()) params.set('q', q.trim());
    const qs = params.toString();
    return request<ListOf<ApiInboxRequest>>(`/api/requests/inbox${qs ? `?${qs}` : ''}`);
  },

  /** The caller's own escalations. Same shape as the HR inbox, scoped server-side. */
  myEscalations: () => request<ListOf<ApiInboxRequest>>('/api/requests/mine'),

  setInboxStatus: (id: string, status: InboxStatus) =>
    request<ApiInboxRequest>(`/api/requests/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),

  respondToEscalation: (id: string, response: string, resolve: boolean) =>
    request<ApiInboxRequest>(`/api/requests/${id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response, resolve }),
    }),

  escalate: (conversationId: string, assistantMessageId?: string, note?: string) =>
    request<{ request_id: string; status: string; message: string }>('/api/chat/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, assistant_message_id: assistantMessageId, note }),
    }),

  documentUrl: (id: string) => request<FileLocation>(`/api/documents/${id}/url`),
  formUrl: (id: string) => request<FileLocation>(`/api/forms/${id}/url`),
};

/* ------------------------------------------------------------------- files */

interface FileLocation {
  /** Either an absolute SAS URL or an API path that still needs a bearer token. */
  url: string;
  expires_in_seconds: number | null;
}

/**
 * Resolve a PDF to something `window.open` can actually load.
 *
 * A bare `window.open('/api/documents/x/content')` is a plain browser navigation:
 * it carries no Authorization header, so an Entra-mode backend answers 401
 * "missing bearer token". Two ways out, and which one applies depends on how the
 * backend stores files:
 *
 *  - Azure storage: the API hands back a short-lived SAS URL that is already
 *    authorized in the query string, so it can be opened as-is.
 *  - Local storage: there is no such URL, so the bytes are fetched here *with*
 *    credentials and wrapped in an object URL.
 *
 * The object URL is revoked on a timer rather than immediately — revoking before
 * the new tab has finished loading leaves the viewer blank.
 */
async function openable(loc: FileLocation): Promise<string> {
  if (/^https?:/i.test(loc.url)) return loc.url;

  const res = await fetch(`${API_BASE}${loc.url}`, { headers: await authHeaders() });
  if (!res.ok) throw new ApiError(`Could not load the file (${res.status})`, res.status);
  const objectUrl = URL.createObjectURL(await res.blob());
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return objectUrl;
}

export const files = {
  documentOpenUrl: (id: string) => api.documentUrl(id).then(openable),
  formOpenUrl: (id: string) => api.formUrl(id).then(openable),
};

/* -------------------------------------------------------------------- chat */

export interface ChatStreamHandlers {
  onMeta?: (data: { conversation_id: string; message_id: string }) => void;
  onDelta?: (text: string) => void;
  onDone?: (data: {
    conversation_id: string;
    message_id: string;
    citations: ApiCitation[];
    confidence: number;
    escalation_offered: boolean;
    /**
     * The fillable form this answer points at, when a cited policy names one. Kept
     * apart from `citations` deliberately — a blank form is not a source, and showing
     * it among the sources would suggest the answer came out of an empty PDF.
     * Absent on older backends.
     */
    form?: { mode: 'resources' | 'external'; form_id: string; title: string; available: boolean } | null;
    /** Server-side breakdown of where the wait went. Absent on older backends. */
    timings?: { retrieval_ms: number; first_token_ms: number | null; total_ms: number };
  }) => void;
}

/**
 * The chat endpoint answers with Server-Sent Events over a POST, so `EventSource`
 * cannot be used — it only issues GETs. This reads the body stream directly.
 */
export async function streamChat(
  message: string,
  conversationId: string | null,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, ...(conversationId ? { conversation_id: conversationId } : {}) }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res
      .json()
      .then((b) => (typeof b?.detail === 'string' ? b.detail : null))
      .catch(() => null);
    throw new ApiError(detail ?? `Chat failed (${res.status})`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line. The final element is kept because it
    // may be a partial frame that completes on the next read.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = frame.match(/^event: (.+)$/m)?.[1];
      const raw = frame.match(/^data: (.+)$/m)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === 'meta') handlers.onMeta?.(data);
      else if (event === 'delta') handlers.onDelta?.(data.text);
      else if (event === 'done') handlers.onDone?.(data);
    }
  }
}
