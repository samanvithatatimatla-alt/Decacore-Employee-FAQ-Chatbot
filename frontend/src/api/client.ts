/**
 * Thin typed wrapper over the FastAPI backend.
 *
 * Identity: while the API runs with AUTH_MODE=dev it takes the caller's identity from
 * an X-Dev-User-Email header rather than a token. Every request goes through here so
 * that swapping to Entra bearer tokens later is a change to one function.
 */

import type { Role } from '../types';

declare global {
  interface Window {
    APP_CONFIG?: { apiBase?: string };
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

function authHeaders(extra: HeadersInit = {}): Headers {
  const h = new Headers(extra);
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers: authHeaders(init.headers) });
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

export interface ApiInboxRequest {
  id: string;
  employee_name?: string | null;
  message: string;
  status: string;
  created_at: string;
  manager_comment?: string | null;
  type?: string | null;
}

/* --------------------------------------------------------------- endpoints */

export const api = {
  me: () => request<ApiMe>('/api/me'),

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

  uploadVersion: (id: string, file: File, changeSummary: string) => {
    const form = new FormData();
    form.append('file', file);
    if (changeSummary) form.append('change_summary', changeSummary);
    return request<ApiDocument>(`/api/documents/${id}/versions`, { method: 'POST', body: form });
  },

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
  inbox: () => request<ListOf<ApiInboxRequest>>('/api/requests/inbox'),

  escalate: (conversationId: string, assistantMessageId?: string, note?: string) =>
    request<{ request_id: string; status: string; message: string }>('/api/chat/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, assistant_message_id: assistantMessageId, note }),
    }),

  /** Absolute URL for opening a policy PDF. The endpoint redirects to a short-lived SAS URL. */
  documentContentUrl: (id: string) => `${API_BASE}/api/documents/${id}/content`,
  formContentUrl: (id: string) => `${API_BASE}/api/forms/${id}/content`,
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
    headers: authHeaders({ 'Content-Type': 'application/json' }),
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
