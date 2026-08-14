// Application state and the tiny render loop around it.
//
// The prototype was a React component: setState, recompute, re-render. This keeps
// the same shape without the dependency — setState patches the object and schedules
// one repaint per frame, so a burst of updates during SSE streaming costs one render.

export const state = {
  screen: 'welcome', // welcome | signin | app
  role: 'employee', // employee | hr_admin — the prototype's "Dev only" switch
  me: null,
  signinEmail: '',
  signingIn: false,

  sidebarOpen: true,
  userMenuOpen: false,
  view: 'chat', // chat | history | resources | contact | dashboard | documents | review | inbox

  // Chat
  chatStarted: false,
  conversationId: null,
  messages: [],
  nextMessageId: 1,
  isTyping: false,
  chatBusy: false,
  copiedMessageId: null,
  draft: '',
  suggestions: [],

  // News ticker
  announcements: [],

  // History
  historyGroups: [],
  historyQuery: '',
  // The prototype's second "Dev only" switch, kept so the empty state stays
  // previewable on a database that already has conversations in it.
  historyMode: 'populated', // populated | empty

  // Resources
  resourceFilter: 'all', // all | favorites | updates
  resourceSearch: '',
  favorites: {}, // document_id -> true, mirrored from the API
  formFavorites: {}, // form_id -> true
  recentlyViewed: [],
  policies: [],
  forms: [],
  updates: [],

  // Employee document viewer
  empDocOpen: false,
  empSelectedDoc: null,
  empDocFullscreen: false,
  empDocCompare: false,
  empDocVersion: 'current',
  empDocBlobUrl: null,

  // HR admin
  documents: [],
  docNameSearch: '',
  docMenuId: null,
  selectedDocId: null,
  reviewBlobUrl: null,
  docViewerFullscreen: false,
  versionHistoryDocId: null,
  versionRows: [],
  newVersionDocId: null,
  newVersionName: '',
  newVersionSummary: '',
  uploadModalOpen: false,
  uploadName: '',
  uploadFile: null,
  uploadBusy: false,

  // HR inbox
  inbox: [],
  inboxFilter: 'all', // all | New | In Progress | Resolved
  inboxSearch: '',
  requestDetailId: null,
  hrResponseDraft: '',
  hrResponseSending: false,
  hrResponseJustSentId: null,

  // Dashboard
  metrics: null,
  charts: null,
};

let renderFn = () => {};
let queued = false;

export function onRender(fn) {
  renderFn = fn;
}

export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    renderFn();
  });
}

export const esc = (v) =>
  String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);

export function toast(message, type = '') {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

export const userName = () =>
  state.me?.display_name || (state.role === 'hr_admin' ? 'Maya Sharma (HR Admin)' : 'Sam Rivera');

export const userFirstName = () => userName().split(' ')[0];

export const userInitials = () =>
  userName()
    .replace(/\(.*\)/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const userTitle = () => {
  if (state.role === 'hr_admin') return 'HR Administrator, People Operations';
  const dept = state.me?.department;
  return dept ? `${state.me.role}, ${dept}` : 'Employee';
};

export const isHrAdmin = () => state.role === 'hr_admin';
