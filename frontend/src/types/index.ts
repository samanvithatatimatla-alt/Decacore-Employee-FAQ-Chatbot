export type Role = 'employee' | 'hr_admin';
export type MessageKind = 'answer' | 'warn' | 'refuse';

export interface Citation {
  name: string;
  ref?: string;
  /** Server document id, so the chip can open the source PDF. Absent on seeded demo data. */
  documentId?: string;
}

export interface FollowUp {
  id: number;
  text: string;
}

export interface ChatStep {
  n: number;
  text: string;
}

export interface FormRef {
  mode: 'resources' | 'external';
  formId?: number;
  url?: string;
  /** Form name, so the chip can say which form rather than just "Resources". */
  title?: string;
}

export interface ChatMessage {
  id: number;
  /** Server id. Present on persisted messages; absent while one is still streaming. */
  apiId?: string;
  citations?: Citation[];
  role: 'user' | 'bot';
  text?: string;
  kind?: MessageKind;
  kicker?: string;
  body?: string;
  steps?: ChatStep[];
  tags?: string[];
  form?: FormRef;
  extLink?: string;
  followUps?: string[];
  /** The backend offered escalation for this answer (low confidence or no policy match). */
  escalated?: boolean;
  /** The employee took that offer and an HR request was created. Distinct from `escalated`. */
  escalationSent?: boolean;
  sourcesExpanded?: boolean;
}

export type HistoryGroupLabel = 'Today' | 'Yesterday' | 'This week';

export interface Conversation {
  id: number;
  apiId?: string;
  label: string;
  time: string;
  group: HistoryGroupLabel;
  messages: ChatMessage[];
}

export interface PolicyDoc {
  id: number;
  apiId?: string;
  name: string;
  /** Policy category, also used to drive the Resources category filter. */
  category: string | null;
  meta: string;
  favorite: boolean;
  version: number;
  updatedOn: string;
  previewTitle: string;
  previewBody: string;
  summary?: string;
}

export interface FormDoc {
  id: number;
  apiId?: string;
  name: string;
  category: string | null;
  meta: string;
  favorite: boolean;
}

export interface RecentlyViewedDoc {
  id: number;
  apiId?: string;
  name: string;
  time: string;
}

export interface PolicyUpdate {
  id: number;
  apiId?: string;
  name: string;
  date: string;
  prevDate: string;
  summary: string;
  question: string;
  prevBody: string;
}

export interface DocVersion {
  uploadedOn: string;
  uploadedBy: string;
  previewTitle: string;
  previewBody: string;
}

export interface AdminDoc {
  id: number;
  apiId?: string;
  name: string;
  /** Policy category ("Leave", "Benefits", ...). Null on documents uploaded without one. */
  category: string | null;
  uploadedOn: string;
  size: string;
  previewTitle: string;
  previewBody: string;
  /** Prior versions only, oldest first. Current live version number is versions.length + 1. */
  versions: DocVersion[];
}

export interface InboxRequest {
  id: number;
  employee: string;
  initials: string;
  question: string;
  status: 'New' | 'In Progress' | 'Resolved';
  received: string;
  response: string;
  sources: Citation[];
  kind?: MessageKind;
  note?: string;
  hrResponse?: string;
}

export interface Announcement {
  id: number;
  date: string;
  headline: string;
  detail: string;
}

export interface TopQuestion {
  text: string;
  count: number;
}

export interface AuthUser {
  firstName: string;
  lastName: string;
  name: string;
  initials: string;
  role: Role;
  title: string;
  email: string;
}
