// Application state and the tiny render loop around it.
//
// The prototype was a React component: setState, recompute, re-render. This keeps
// the same shape without the dependency — setState patches the object and schedules
// one repaint per frame, so a burst of updates during SSE streaming costs one render.

import { ACCESS_DEPARTMENTS, ACCESS_GROUPS } from './seed.js';

const FAVORITES_KEY = 'hrbot.favorites';
const RECENTS_KEY = 'hrbot.recentlyViewed';

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function freshAccess() {
  return {
    accessGroups: Object.fromEntries(ACCESS_GROUPS.map((g, i) => [g, i === 0])),
    accessDepts: Object.fromEntries(ACCESS_DEPARTMENTS.map((d) => [d, false])),
    accessPeople: [],
    peopleQuery: '',
  };
}

export const state = {
  screen: 'welcome', // welcome | signin | app
  role: 'employee', // employee | hr_admin — the prototype's "Dev only" switch
  me: null,
  signinEmail: '',
  signingIn: false,

  sidebarOpen: true,
  userMenuOpen: false,
  view: 'chat', // chat | history | resources | contact | dashboard | documents | review

  // Chat
  chatStarted: false,
  conversationId: null,
  messages: [],
  nextMessageId: 1,
  isTyping: false,
  chatBusy: false,
  copiedMessageId: null,
  homeDraft: '',
  suggestions: [],

  // Announcements banner
  newsExpanded: false,
  newsDismissed: false,

  // History
  historyGroups: [],
  historyQuery: '',
  // The prototype's second "Dev only" switch, kept so the empty state stays
  // previewable on a database that already has conversations in it.
  historyMode: 'populated', // populated | empty

  // Resources
  resourceFilter: 'all', // all | favorites | updates
  favorites: loadJSON(FAVORITES_KEY, {}),
  recentlyViewed: loadJSON(RECENTS_KEY, []),
  highlightFormId: null,
  policies: [],

  // Employee document viewer
  empDocOpen: false,
  empSelectedDoc: null,
  empDocFullscreen: false,
  empDocCompare: false,
  empDocVersion: 'current',
  empDocBlobUrl: null,

  // HR admin
  documents: [],
  docFilter: 'all', // all | Pending | Approved | Rejected
  docMenuId: null,
  selectedDocId: null,
  reviewBlobUrl: null,
  docViewerFullscreen: false,
  versionHistoryDocId: null,
  newVersionDocId: null,
  newVersionName: '',
  newVersionSummary: '',
  uploadModalOpen: false,
  uploadName: '',
  uploadFile: null,
  uploadCategory: 'Leave',
  uploadBusy: false,
  reviewPeopleQuery: '',
  ...freshAccess(),

  // Dashboard
  metrics: null,
  charts: null,

  busy: false,
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

export function persistFavorites() {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
  } catch {
    /* private browsing — favourites just do not survive the session */
  }
}

// Keeps the three most recently opened documents, newest first.
export function noteRecentlyViewed(doc) {
  const entry = { id: doc.id, name: doc.name, time: 'Viewed just now' };
  const rest = state.recentlyViewed.filter((r) => r.id !== doc.id);
  state.recentlyViewed = [entry, ...rest].slice(0, 3);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recentlyViewed));
  } catch {
    /* ignore */
  }
}

export const esc = (v) =>
  String(v ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);

// Conditional class helper, so templates read like the prototype's {{ navChatActive }}.
export const cls = (...parts) => parts.filter(Boolean).join(' ');

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
  return dept ? `${state.me.role}, ${dept}` : 'Software Engineer, Engineering';
};

export const isHrAdmin = () => state.role === 'hr_admin';
