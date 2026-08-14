// Entry point: wires state to the views, and actions to the API.
//
// Rendering is whole-document innerHTML on each change, which keeps the view
// functions pure string templates. The two things that must survive a repaint —
// keyboard focus and the scroll position of the message thread — are saved and
// restored around it.

import * as API from './api.js';
import { onRender, setState, state, toast } from './store.js';
import { chatHome, chatThread, contactView, empDocModal, historyView, resourcesView } from './views-employee.js';
import {
  dashboardView,
  documentsView,
  inboxView,
  newVersionModal,
  requestDetailModal,
  reviewView,
  uploadModal,
  versionHistoryModal,
} from './views-admin.js';
import { sidebar, signinScreen, ticker, topNav, welcomeScreen } from './views-shell.js';

const root = document.getElementById('app');

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function mainContent() {
  switch (state.view) {
    case 'chat':
      return state.chatStarted ? chatThread() : chatHome();
    case 'history':
      return historyView();
    case 'resources':
      return resourcesView();
    case 'contact':
      return contactView();
    case 'dashboard':
      return dashboardView();
    case 'documents':
      return documentsView();
    case 'review':
      return reviewView();
    case 'inbox':
      return inboxView();
    default:
      return chatHome();
  }
}

function appScreen() {
  return `
${ticker()}
${topNav()}
<div class="body-row">
  ${sidebar()}
  <main class="main">
    ${mainContent()}
    ${uploadModal()}
    ${versionHistoryModal()}
    ${newVersionModal()}
    ${requestDetailModal()}
  </main>
</div>
${empDocModal()}`;
}

function render() {
  const active = document.activeElement;
  const focusKey = active?.dataset?.focusKey;
  const selStart = active?.selectionStart;
  const selEnd = active?.selectionEnd;
  const thread = root.querySelector('.thread');
  const atBottom = thread ? thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80 : true;
  const threadTop = thread?.scrollTop;

  const body = state.screen === 'welcome' ? welcomeScreen() : state.screen === 'signin' ? signinScreen() : appScreen();
  root.innerHTML = `<div class="app">${body}</div>`;

  if (focusKey) {
    const el = root.querySelector(`[data-focus-key="${focusKey}"]`);
    if (el) {
      el.focus();
      if (selStart != null && el.setSelectionRange) {
        try {
          el.setSelectionRange(selStart, selEnd);
        } catch {
          /* inputs that do not support selection (email, number) */
        }
      }
    }
  }

  const newThread = root.querySelector('.thread');
  if (newThread) newThread.scrollTop = atBottom ? newThread.scrollHeight : (threadTop ?? 0);
}

onRender(render);

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadFavorites() {
  const [docs, forms] = await Promise.all([
    API.listFavorites().catch(() => ({ items: [] })),
    API.api('/api/forms/favorites').catch(() => ({ items: [] })),
  ]);
  setState({
    favorites: Object.fromEntries((docs.items || []).map((f) => [f.document_id, true])),
    formFavorites: Object.fromEntries((forms.items || []).map((id) => [id, true])),
  });
}

async function loadForView(view) {
  try {
    if (view === 'chat' && !state.suggestions.length) {
      const faq = await API.listFaq().catch(() => ({ items: [] }));
      setState({ suggestions: (faq.items || []).map((x) => x.question) });
    }
    if (view === 'history') {
      setState({ historyGroups: API.groupConversations((await API.listConversations()).items || []) });
    }
    if (view === 'resources') {
      const [docs, forms, updates, recents] = await Promise.all([
        API.listDocuments(),
        API.listForms().catch(() => ({ items: [] })),
        API.listUpdates().catch(() => ({ items: [] })),
        API.listRecentlyViewed().catch(() => ({ items: [] })),
      ]);
      setState({
        policies: (docs.items || []).filter((d) => d.status === 'approved').map(API.toDocRecord),
        forms: forms.items || [],
        updates: updates.items || [],
        recentlyViewed: (recents.items || []).map((r) => ({ ...r, viewedLabel: API.relativeViewed(r.last_viewed_at) })),
      });
      await loadFavorites();
    }
    if (view === 'documents' || view === 'review') {
      setState({ documents: ((await API.listDocuments()).items || []).map(API.toDocRecord) });
    }
    if (view === 'dashboard') {
      const [metrics, charts, updates] = await Promise.all([
        API.getMetrics(),
        API.getCharts(),
        API.listUpdates().catch(() => ({ items: [] })),
      ]);
      setState({ metrics, charts, updates: updates.items || [] });
    }
    if (view === 'inbox') {
      await reloadInbox();
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reloadInbox() {
  try {
    const data = await API.listInbox({ status: state.inboxFilter, q: state.inboxSearch.trim() });
    setState({ inbox: data.items || [] });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// The sidebar's Recents block reads from historyGroups, so history is refreshed
// alongside whatever view was asked for.
async function refreshRecents() {
  try {
    setState({ historyGroups: API.groupConversations((await API.listConversations()).items || []) });
  } catch {
    /* the sidebar just shows no recents */
  }
}

async function loadTicker() {
  try {
    setState({ announcements: (await API.listAnnouncements()).items || [] });
  } catch {
    /* the ticker simply does not render */
  }
}

async function goTo(view) {
  setState({ view, docMenuId: null, userMenuOpen: false });
  await loadForView(view);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

async function sendChat(text) {
  const message = (text ?? state.draft).trim();
  if (!message || state.chatBusy) return;

  setState({
    messages: [...state.messages, { id: state.nextMessageId, role: 'user', text: message }],
    nextMessageId: state.nextMessageId + 1,
    draft: '',
    chatStarted: true,
    view: 'chat',
    isTyping: true,
    chatBusy: true,
  });

  let botId = null;
  const patchBot = (patch) =>
    setState({ messages: state.messages.map((m) => (m.id === botId ? { ...m, ...patch } : m)) });

  const ensureBot = () => {
    if (botId != null) return;
    botId = state.nextMessageId;
    setState({
      messages: [
        ...state.messages,
        { id: botId, role: 'bot', kind: 'answer', kicker: 'Answer', body: '', tags: [], streaming: true },
      ],
      nextMessageId: state.nextMessageId + 1,
      isTyping: false,
    });
  };

  try {
    await API.streamChat(
      { message, conversationId: state.conversationId },
      {
        onMeta: (d) => setState({ conversationId: d.conversation_id }),
        onDelta: (d) => {
          ensureBot();
          const current = state.messages.find((m) => m.id === botId);
          patchBot({ body: (current?.body || '') + d.text });
        },
        onDone: (d) => {
          ensureBot();
          const citations = d.citations || [];
          const { kind, kicker } = API.botKind(citations, d.escalation_offered);
          patchBot({
            kind,
            kicker,
            tags: citations.map(API.citationLabel),
            messageId: d.message_id,
            streaming: false,
          });
        },
      },
    );
  } catch (e) {
    if (botId != null) patchBot({ kind: 'refuse', kicker: 'Something went wrong', body: e.message, streaming: false });
    else
      setState({
        messages: [
          ...state.messages,
          { id: state.nextMessageId, role: 'bot', kind: 'refuse', kicker: 'Something went wrong', body: e.message, tags: [] },
        ],
        nextMessageId: state.nextMessageId + 1,
      });
  } finally {
    setState({ chatBusy: false, isTyping: false });
    refreshRecents();
  }
}

async function openConversation(id) {
  try {
    const conv = await API.getConversation(id);
    let nextId = 1;
    const messages = conv.messages.map((m) => {
      if (m.role === 'user') return { id: nextId++, role: 'user', text: m.content };
      const citations = m.citations || [];
      // Stored messages do not carry the escalation flag the live stream sends, so
      // the card state is derived from what was saved: cited answers read as answers.
      const { kind, kicker } = API.botKind(citations, m.escalated && !citations.length);
      return {
        id: nextId++,
        role: 'bot',
        kind,
        kicker,
        body: m.content,
        tags: citations.map(API.citationLabel),
        messageId: m.id,
        escalated: m.escalated,
      };
    });
    setState({ conversationId: id, messages, nextMessageId: nextId, chatStarted: true, view: 'chat' });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function escalate(msgId) {
  const m = state.messages.find((x) => x.id === msgId);
  if (m && !m.escalated && state.conversationId) {
    try {
      await API.escalateChat(state.conversationId, m.messageId, null);
      setState({ messages: state.messages.map((x) => (x.id === msgId ? { ...x, escalated: true } : x)) });
      toast('Question sent to HR.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  }
  // The prototype's card button lands the employee on the Connect to HR screen.
  await goTo('contact');
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

const revoke = (url) => {
  if (url) URL.revokeObjectURL(url);
};

async function openPolicy(id) {
  const doc = state.policies.find((p) => p.id === id) || state.documents.find((d) => d.id === id);
  if (!doc) return;
  revoke(state.empDocBlobUrl);
  setState({
    empDocOpen: true,
    empSelectedDoc: doc,
    empDocCompare: false,
    empDocVersion: 'current',
    empDocBlobUrl: null,
  });
  try {
    setState({ empDocBlobUrl: await API.documentContentUrl(id) });
    await API.noteViewed(id).catch(() => {});
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function compareUpdate(documentId) {
  const update = state.updates.find((u) => u.document_id === documentId);
  if (!update) return;
  revoke(state.empDocBlobUrl);
  setState({
    empDocOpen: true,
    empDocCompare: true,
    empDocVersion: 'current',
    empDocBlobUrl: null,
    empSelectedDoc: { id: documentId, name: update.name, previewTitle: update.title, compare: update },
  });
  await loadCompareVersion('current');
}

async function loadCompareVersion(which) {
  const doc = state.empSelectedDoc;
  if (!doc?.compare) return;
  const n = which === 'prev' ? doc.compare.previous_version_number : doc.compare.version_number;
  revoke(state.empDocBlobUrl);
  setState({ empDocVersion: which, empDocBlobUrl: null });
  try {
    setState({ empDocBlobUrl: await API.versionContentUrl(doc.id, n) });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reviewDoc(id) {
  revoke(state.reviewBlobUrl);
  setState({ view: 'review', selectedDocId: id, docMenuId: null, versionHistoryDocId: null, reviewBlobUrl: null });
  if (!state.documents.length) await loadForView('review');
  try {
    setState({ reviewBlobUrl: await API.documentContentUrl(id) });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadVersions(id) {
  try {
    setState({ versionRows: (await API.listVersions(id)).items || [] });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function submitUpload() {
  if (!state.uploadFile) {
    toast('Choose a PDF to upload.', 'error');
    return;
  }
  setState({ uploadBusy: true });
  try {
    const title = state.uploadName.replace(/\.pdf$/i, '').replace(/_/g, ' ');
    await API.uploadDocument(state.uploadFile, title);
    toast('Document uploaded and available to employees.', 'success');
    setState({ uploadModalOpen: false, uploadFile: null, uploadName: '' });
    await loadForView('documents');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setState({ uploadBusy: false });
  }
}

async function submitNewVersion() {
  if (!state.uploadFile) {
    toast('Choose a PDF to upload.', 'error');
    return;
  }
  setState({ uploadBusy: true });
  try {
    await API.uploadVersion(state.newVersionDocId, state.uploadFile, state.newVersionSummary.trim());
    toast('New version published.', 'success');
    setState({ newVersionDocId: null, uploadFile: null, newVersionName: '', newVersionSummary: '' });
    await loadForView('documents');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    setState({ uploadBusy: false });
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const actions = {
  goWelcome: () => setState({ screen: 'welcome', userMenuOpen: false }),
  goSignin: () => setState({ screen: 'signin' }),

  signin: async () => {
    const typed = state.signinEmail.trim();
    API.setIdentity(typed || API.PERSONAS[state.role].email);
    setState({ signingIn: true });
    try {
      const me = await API.getMe();
      setState({
        me,
        screen: 'app',
        role: me.role === 'HRAdmin' ? 'hr_admin' : 'employee',
        view: me.role === 'HRAdmin' ? 'dashboard' : 'chat',
      });
      await Promise.all([loadForView(state.view), refreshRecents(), loadTicker(), loadFavorites()]);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setState({ signingIn: false });
    }
  },

  signOut: () =>
    setState({
      screen: 'welcome',
      me: null,
      userMenuOpen: false,
      messages: [],
      conversationId: null,
      chatStarted: false,
    }),

  setRole: async (value) => {
    API.setIdentity(API.PERSONAS[value].email);
    const hrOnly = ['dashboard', 'documents', 'review', 'inbox'];
    setState({ role: value, view: hrOnly.includes(state.view) && value === 'employee' ? 'chat' : state.view });
    try {
      setState({ me: await API.getMe() });
    } catch (e) {
      toast(e.message, 'error');
    }
    await Promise.all([loadForView(state.view), refreshRecents(), loadTicker(), loadFavorites()]);
  },

  setHistoryMode: (value) => setState({ historyMode: value }),
  toggleSidebar: () => setState({ sidebarOpen: !state.sidebarOpen }),
  toggleUserMenu: () => setState({ userMenuOpen: !state.userMenuOpen }),

  go: (view) => goTo(view),
  goPolicyUpdates: async () => {
    setState({ resourceFilter: 'updates' });
    await goTo('resources');
  },
  newChat: () =>
    setState({ messages: [], conversationId: null, chatStarted: false, view: 'chat', draft: '', isTyping: false }),

  send: () => sendChat(),
  ask: (text) => sendChat(text),
  toggleSources: (id) =>
    setState({
      messages: state.messages.map((m) => (m.id === Number(id) ? { ...m, sourcesExpanded: !m.sourcesExpanded } : m)),
    }),
  copy: (id) => {
    const m = state.messages.find((x) => x.id === Number(id));
    if (m && navigator.clipboard) navigator.clipboard.writeText(m.body || m.text || '').catch(() => {});
    setState({ copiedMessageId: Number(id) });
    setTimeout(() => {
      if (state.copiedMessageId === Number(id)) setState({ copiedMessageId: null });
    }, 1500);
  },
  escalate: (id) => escalate(Number(id)),
  openConversation: (id) => openConversation(id),

  setResFilter: (key) => setState({ resourceFilter: key }),
  toggleFav: async (id) => {
    const on = !state.favorites[id];
    setState({ favorites: { ...state.favorites, [id]: on } });
    try {
      await (on ? API.addFavorite(id) : API.removeFavorite(id));
    } catch (e) {
      // Put the star back the way it was if the server disagreed.
      setState({ favorites: { ...state.favorites, [id]: !on } });
      toast(e.message, 'error');
    }
  },
  toggleFormFav: async (id) => {
    const on = !state.formFavorites[id];
    setState({ formFavorites: { ...state.formFavorites, [id]: on } });
    try {
      await API.api(`/api/forms/${id}/favorite`, { method: on ? 'PUT' : 'DELETE' });
    } catch (e) {
      setState({ formFavorites: { ...state.formFavorites, [id]: !on } });
      toast(e.message, 'error');
    }
  },
  openPolicy: (id) => openPolicy(id),
  compareUpdate: (id) => compareUpdate(id),
  showVersion: (which) => loadCompareVersion(which),
  closeEmpDoc: () => {
    revoke(state.empDocBlobUrl);
    setState({ empDocOpen: false, empDocBlobUrl: null, empDocFullscreen: false, empDocCompare: false });
  },
  toggleEmpFullscreen: () => setState({ empDocFullscreen: !state.empDocFullscreen }),
  downloadForm: async (id) => {
    try {
      const url = await API.formContentUrl(id);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  toggleDocMenu: (id) => setState({ docMenuId: state.docMenuId === id ? null : id }),
  reviewDoc: (id) => reviewDoc(id),
  versionHistory: async (id) => {
    setState({ versionHistoryDocId: id, docMenuId: null, versionRows: [] });
    await loadVersions(id);
  },
  closeVersionHistory: () => setState({ versionHistoryDocId: null, versionRows: [] }),
  viewVersion: async (n) => {
    const id = state.versionHistoryDocId;
    setState({ versionHistoryDocId: null, versionRows: [] });
    try {
      const url = await API.versionContentUrl(id, Number(n));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  newVersion: async (id) => {
    setState({
      newVersionDocId: id,
      newVersionName: '',
      newVersionSummary: '',
      uploadFile: null,
      docMenuId: null,
      versionRows: [],
    });
    await loadVersions(id);
  },
  closeNewVersion: () => setState({ newVersionDocId: null, uploadFile: null, versionRows: [] }),
  submitNewVersion: () => submitNewVersion(),
  removeDoc: async (id) => {
    setState({ docMenuId: null });
    if (!confirm('Remove this document? It will stop appearing in answers immediately.')) return;
    try {
      await API.deleteDocument(id);
      toast('Document removed.', 'success');
      await loadForView('documents');
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  openUpload: () => setState({ uploadModalOpen: true, uploadName: '', uploadFile: null }),
  closeUpload: () => setState({ uploadModalOpen: false, uploadFile: null }),
  pickFile: () => document.getElementById('uploadFileInput')?.click(),
  submitUpload: () => submitUpload(),

  toggleReviewFullscreen: () => setState({ docViewerFullscreen: !state.docViewerFullscreen }),
  downloadDoc: async (id) => {
    try {
      const url = await API.documentContentUrl(id);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  setInboxFilter: async (key) => {
    setState({ inboxFilter: key });
    await reloadInbox();
  },
  viewRequest: (id) => {
    const r = state.inbox.find((x) => x.id === id);
    setState({
      requestDetailId: id,
      hrResponseDraft: r?.hr_response || '',
      hrResponseSending: false,
      hrResponseJustSentId: null,
    });
  },
  closeRequestDetail: () => setState({ requestDetailId: null, hrResponseJustSentId: null }),
  startRequest: async (id) => {
    try {
      await API.setInboxStatus(id, 'In Progress');
      await reloadInbox();
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  respondRequest: async (id) => {
    const text = state.hrResponseDraft.trim();
    if (!text) {
      toast('Write a response first.', 'error');
      return;
    }
    setState({ hrResponseSending: true });
    try {
      await API.respondToRequest(id, text, false);
      await reloadInbox();
      setState({ hrResponseJustSentId: id });
      toast('Response sent to the employee.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setState({ hrResponseSending: false });
    }
  },
  resolveRequest: async (id) => {
    const text = state.hrResponseDraft.trim();
    try {
      if (text) await API.respondToRequest(id, text, true);
      else await API.setInboxStatus(id, 'Resolved');
      await reloadInbox();
      setState({ requestDetailId: null });
      toast('Request resolved.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
};

// ---------------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------------

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.tagName === 'SELECT') return; // selects act on `change`
  // A click inside a modal card must not reach the backdrop's close action.
  const stop = e.target.closest('[data-stop]');
  if (stop && !stop.contains(el)) return;
  if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  actions[el.dataset.act]?.(el.dataset.arg);
});

root.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'uploadFileInput' && el.files?.[0]) {
    const file = el.files[0];
    setState(
      state.newVersionDocId
        ? { uploadFile: file, newVersionName: file.name }
        : { uploadFile: file, uploadName: file.name },
    );
    return;
  }
  if (el.tagName === 'SELECT') {
    const act = el.closest('[data-act]')?.dataset.act;
    if (act) actions[act]?.(el.value);
  }
});

// Text inputs write straight back into state so a repaint cannot lose them.
// `data-live` marks the ones whose value changes what is rendered — the search
// boxes — and those additionally schedule a repaint.
let inboxSearchTimer = null;
root.addEventListener('input', (e) => {
  const key = e.target.dataset.model;
  if (!key) return;
  state[key] = e.target.value;
  if (e.target.dataset.live === undefined) return;
  setState({});
  if (key === 'inboxSearch') {
    // Inbox search filters server-side; debounce so typing is not a request per key.
    clearTimeout(inboxSearchTimer);
    inboxSearchTimer = setTimeout(reloadInbox, 250);
  }
});

root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const act = e.target.dataset.actEnter;
  if (!act) return;
  e.preventDefault();
  actions[act]?.();
});

// Clicking anywhere else dismisses the kebab and account menus.
document.addEventListener('click', (e) => {
  if (state.docMenuId && !e.target.closest('.kebab-wrap')) setState({ docMenuId: null });
  if (state.userMenuOpen && !e.target.closest('.sidebar-footer')) setState({ userMenuOpen: false });
});

render();
