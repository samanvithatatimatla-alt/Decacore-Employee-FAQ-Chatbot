// Entry point: wires state to the views, and actions to the API.
//
// Rendering is whole-document innerHTML on each change, which keeps the view
// functions pure string templates. The two things that survive a repaint —
// keyboard focus and the scroll position of the message thread — are saved and
// restored around it.

import {
  PERSONAS,
  api,
  botKind,
  citationLabel,
  documentContentUrl,
  groupConversations,
  groupToRole,
  setIdentity,
  streamChat,
  toDocRecord,
} from './api.js';
import { POLICY_UPDATES } from './seed.js';
import {
  freshAccess,
  noteRecentlyViewed,
  onRender,
  persistFavorites,
  setState,
  state,
  toast,
} from './store.js';
import { chatHome, chatThread, contactView, empDocModal, historyView, resourcesView } from './views-employee.js';
import { dashboardView, documentsView, newVersionModal, reviewView, uploadModal, versionHistoryModal } from './views-admin.js';
import { sidebar, signinScreen, topNav, welcomeScreen } from './views-shell.js';

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
    default:
      return chatHome();
  }
}

function appScreen() {
  return `
${topNav()}
<div class="body-row">
  ${sidebar()}
  <main class="main">
    ${mainContent()}
    ${uploadModal()}
    ${versionHistoryModal()}
    ${newVersionModal()}
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
  const threadAtBottom = thread ? thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80 : true;
  const threadTop = thread?.scrollTop;

  const body =
    state.screen === 'welcome' ? welcomeScreen() : state.screen === 'signin' ? signinScreen() : appScreen();
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
  if (newThread) newThread.scrollTop = threadAtBottom ? newThread.scrollHeight : (threadTop ?? 0);
}

onRender(render);

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadForView(view) {
  try {
    if (view === 'chat' && !state.suggestions.length) {
      const faq = await api('/api/faq/top').catch(() => ({ items: [] }));
      setState({ suggestions: (faq.items || []).map((x) => x.question) });
    }
    if (view === 'history') {
      const data = await api('/api/conversations');
      setState({ historyGroups: groupConversations(data.items || []) });
    }
    if (view === 'resources') {
      const data = await api('/api/documents');
      const approved = (data.items || []).filter((d) => d.status === 'approved').map(toDocRecord);
      setState({ policies: approved });
    }
    if (view === 'documents' || view === 'review') {
      const data = await api('/api/documents');
      setState({ documents: (data.items || []).map(toDocRecord) });
    }
    if (view === 'dashboard') {
      const [metrics, charts] = await Promise.all([api('/api/dashboard/metrics'), api('/api/dashboard/charts')]);
      setState({ metrics, charts });
    }
  } catch (e) {
    toast(e.message, 'error');
  }
}

// The sidebar's Recents block reads from historyGroups, so history is refreshed
// alongside whatever view was asked for.
async function refreshRecents() {
  try {
    const data = await api('/api/conversations');
    setState({ historyGroups: groupConversations(data.items || []) });
  } catch {
    /* the sidebar just shows no recents */
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
  const message = (text ?? state.homeDraft).trim();
  if (!message || state.chatBusy) return;

  const userMsg = { id: state.nextMessageId, role: 'user', text: message };
  setState({
    messages: [...state.messages, userMsg],
    nextMessageId: state.nextMessageId + 1,
    homeDraft: '',
    chatStarted: true,
    view: 'chat',
    isTyping: true,
    chatBusy: true,
  });

  let bot = null;
  const upsertBot = (patch) => {
    setState({
      messages: state.messages.map((m) => (m.id === bot.id ? { ...m, ...patch } : m)),
    });
  };

  try {
    await streamChat(
      { message, conversationId: state.conversationId },
      {
        onMeta: (d) => setState({ conversationId: d.conversation_id }),
        onDelta: (d) => {
          if (!bot) {
            bot = {
              id: state.nextMessageId,
              role: 'bot',
              kind: 'answer',
              kicker: 'Answer',
              body: '',
              tags: [],
              streaming: true,
            };
            setState({ messages: [...state.messages, bot], nextMessageId: state.nextMessageId + 1, isTyping: false });
          }
          const current = state.messages.find((m) => m.id === bot.id);
          upsertBot({ body: (current?.body || '') + d.text });
        },
        onDone: (d) => {
          const citations = d.citations || [];
          const { kind, kicker } = botKind(citations, d.escalation_offered);
          if (!bot) {
            bot = { id: state.nextMessageId, role: 'bot', body: '' };
            setState({ messages: [...state.messages, bot], nextMessageId: state.nextMessageId + 1, isTyping: false });
          }
          upsertBot({
            kind,
            kicker,
            tags: citations.map(citationLabel),
            messageId: d.message_id,
            streaming: false,
          });
        },
      },
    );
  } catch (e) {
    if (bot) upsertBot({ kind: 'refuse', kicker: 'Something went wrong', body: e.message, streaming: false });
    else
      setState({
        messages: [
          ...state.messages,
          { id: state.nextMessageId, role: 'bot', kind: 'refuse', kicker: 'Something went wrong', body: e.message, tags: [] },
        ],
        nextMessageId: state.nextMessageId + 1,
      });
    setState({ isTyping: false });
  } finally {
    setState({ chatBusy: false, isTyping: false });
    refreshRecents();
  }
}

async function openConversation(id) {
  try {
    const conv = await api(`/api/conversations/${id}`);
    let nextId = 1;
    const messages = conv.messages.map((m) => {
      if (m.role === 'user') return { id: nextId++, role: 'user', text: m.content };
      const citations = m.citations || [];
      // Stored messages do not carry the escalation flag the live stream sends, so
      // the card state is derived from what was saved: cited answers read as answers.
      const { kind, kicker } = botKind(citations, m.escalated && !citations.length);
      return {
        id: nextId++,
        role: 'bot',
        kind,
        kicker,
        body: m.content,
        tags: citations.map(citationLabel),
        messageId: m.id,
        escalated: m.escalated,
      };
    });
    setState({
      conversationId: id,
      messages,
      nextMessageId: nextId,
      chatStarted: true,
      view: 'chat',
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function escalate(msgId) {
  const m = state.messages.find((x) => x.id === msgId);
  if (!m || m.escalated || !state.conversationId) {
    await goTo('contact');
    return;
  }
  try {
    await api('/api/chat/escalate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: state.conversationId,
        assistant_message_id: m.messageId || null,
        note: null,
      }),
    });
    setState({ messages: state.messages.map((x) => (x.id === msgId ? { ...x, escalated: true } : x)) });
    toast('Question sent to HR.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
  // The prototype's card button lands the employee on the Connect to HR screen.
  await goTo('contact');
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

async function openPolicy(id) {
  const doc = state.policies.find((p) => p.id === id) || state.documents.find((d) => d.id === id);
  if (!doc) return;
  noteRecentlyViewed(doc);
  setState({ empDocOpen: true, empSelectedDoc: doc, empDocCompare: false, empDocVersion: 'current', empDocBlobUrl: null });
  try {
    setState({ empDocBlobUrl: await documentContentUrl(id) });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function closeEmpDoc() {
  if (state.empDocBlobUrl) URL.revokeObjectURL(state.empDocBlobUrl);
  setState({ empDocOpen: false, empDocBlobUrl: null, empDocFullscreen: false, empDocCompare: false, empDocVersion: 'current' });
}

async function reviewDoc(id) {
  if (state.reviewBlobUrl) URL.revokeObjectURL(state.reviewBlobUrl);
  setState({ view: 'review', selectedDocId: id, docMenuId: null, versionHistoryDocId: null, reviewBlobUrl: null });
  if (!state.documents.length) await loadForView('review');
  try {
    setState({ reviewBlobUrl: await documentContentUrl(id) });
  } catch (e) {
    toast(e.message, 'error');
  }
}

// Group checkboxes map onto the backend's three roles, but there is no endpoint to
// change a document's allowed_roles after upload, and departments and named
// individuals have no backend representation at all. So the whole Visible To block
// edits session state only — the checkboxes reflect what was set at upload time.
function setDocumentAudience(doc, audience) {
  setState({
    documents: state.documents.map((d) =>
      d.id === doc.id ? { ...d, audience, audienceLabel: audience.join(', ') || '—' } : d,
    ),
  });
}

const draftRoles = () =>
  Object.keys(state.accessGroups)
    .filter((g) => state.accessGroups[g])
    .map(groupToRole)
    .filter(Boolean);

async function submitUpload() {
  if (!state.uploadFile) {
    toast('Choose a PDF to upload.', 'error');
    return;
  }
  const roles = draftRoles();
  if (!roles.length) {
    toast('Select at least one group.', 'error');
    return;
  }
  setState({ uploadBusy: true });
  try {
    const fd = new FormData();
    fd.append('file', state.uploadFile);
    fd.append('permissions', roles.join(','));
    if (state.uploadName) fd.append('title', state.uploadName.replace(/\.pdf$/i, '').replace(/_/g, ' '));
    await api('/api/documents', { method: 'POST', body: fd });
    toast('Document uploaded for HR approval.', 'success');
    setState({ uploadModalOpen: false, newVersionDocId: null, uploadFile: null, uploadName: '' });
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
    setIdentity(typed || PERSONAS[state.role].email);
    setState({ signingIn: true });
    try {
      const me = await api('/api/me');
      setState({
        me,
        screen: 'app',
        role: me.role === 'HRAdmin' ? 'hr_admin' : 'employee',
        view: me.role === 'HRAdmin' ? 'dashboard' : 'chat',
      });
      await loadForView(state.view);
      await refreshRecents();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setState({ signingIn: false });
    }
  },

  signOut: () => {
    setState({ screen: 'welcome', me: null, userMenuOpen: false, messages: [], conversationId: null, chatStarted: false });
  },

  setRole: async (value) => {
    setIdentity(PERSONAS[value].email);
    const hrOnly = ['dashboard', 'documents', 'review'];
    setState({ role: value, view: hrOnly.includes(state.view) && value === 'employee' ? 'chat' : state.view });
    try {
      setState({ me: await api('/api/me') });
    } catch (e) {
      toast(e.message, 'error');
    }
    await loadForView(state.view);
    await refreshRecents();
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
    setState({ messages: [], conversationId: null, chatStarted: false, view: 'chat', homeDraft: '', isTyping: false }),

  expandNews: () => setState({ newsExpanded: true }),
  collapseNews: () => setState({ newsExpanded: false }),
  dismissNews: () => setState({ newsDismissed: true, newsExpanded: false }),
  restoreNews: () => setState({ newsDismissed: false, newsExpanded: false }),

  sendHome: () => sendChat(),
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

  setResFilter: (key) => setState({ resourceFilter: key, highlightFormId: null }),
  toggleFav: (key) => {
    setState({ favorites: { ...state.favorites, [key]: !state.favorites[key] } });
    persistFavorites();
  },
  openPolicy: (id) => openPolicy(id),
  compareUpdate: (id) => {
    const update = POLICY_UPDATES.find((u) => u.id === Number(id));
    if (!update) return;
    setState({
      empDocOpen: true,
      empDocCompare: true,
      empDocVersion: 'current',
      empDocBlobUrl: null,
      empSelectedDoc: {
        id: `update-${update.id}`,
        updateId: update.id,
        name: update.name,
        previewTitle: update.previewTitle,
        previewBody: update.previewBody,
      },
    });
  },
  showVersion: (which) => setState({ empDocVersion: which }),
  closeEmpDoc,
  toggleEmpFullscreen: () => setState({ empDocFullscreen: !state.empDocFullscreen }),

  setDocFilter: (key) => setState({ docFilter: key, docMenuId: null }),
  toggleDocMenu: (id) => setState({ docMenuId: state.docMenuId === id ? null : id }),
  reviewDoc: (id) => reviewDoc(id),
  versionHistory: (id) => setState({ versionHistoryDocId: id, docMenuId: null }),
  closeVersionHistory: () => setState({ versionHistoryDocId: null }),
  newVersion: (id) => setState({ newVersionDocId: id, newVersionName: '', newVersionSummary: '', docMenuId: null, ...freshAccess() }),
  closeNewVersion: () => setState({ newVersionDocId: null, uploadFile: null }),
  submitNewVersion: () => submitUpload(),
  removeDoc: (id) => {
    // No delete endpoint exists yet; this hides the row for the session only.
    setState({ documents: state.documents.filter((d) => d.id !== id), docMenuId: null });
    toast('Removed from this view. Deletion is not yet wired to the API.', '');
  },

  openUpload: () => setState({ uploadModalOpen: true, uploadName: '', uploadFile: null, uploadCategory: 'Leave', ...freshAccess() }),
  closeUpload: () => setState({ uploadModalOpen: false, uploadFile: null }),
  pickFile: () => document.getElementById('uploadFileInput')?.click(),
  setUploadCategory: (value) => setState({ uploadCategory: value }),
  submitUpload: () => submitUpload(),

  toggleAccessGroup: (g) => setState({ accessGroups: { ...state.accessGroups, [g]: !state.accessGroups[g] } }),
  toggleAccessDept: (d) => setState({ accessDepts: { ...state.accessDepts, [d]: !state.accessDepts[d] } }),
  addAccessPerson: (name) =>
    setState({
      accessPeople: state.accessPeople.includes(name) ? state.accessPeople : [...state.accessPeople, name],
      peopleQuery: '',
    }),
  removeAccessPerson: (name) => setState({ accessPeople: state.accessPeople.filter((n) => n !== name) }),

  toggleReviewGroup: (g) => {
    const doc = state.documents.find((d) => d.id === state.selectedDocId);
    if (!doc) return;
    const audience = doc.audience.includes(g) ? doc.audience.filter((a) => a !== g) : [...doc.audience, g];
    setDocumentAudience(doc, audience);
  },
  toggleReviewDept: (d) => {
    const doc = state.documents.find((x) => x.id === state.selectedDocId);
    if (!doc) return;
    const audience = doc.audience.includes(d) ? doc.audience.filter((a) => a !== d) : [...doc.audience, d];
    setDocumentAudience(doc, audience);
  },
  addReviewPerson: (name) => {
    const doc = state.documents.find((d) => d.id === state.selectedDocId);
    if (!doc) return;
    setDocumentAudience(doc, [...doc.audience, name]);
    setState({ reviewPeopleQuery: '' });
  },
  removeReviewPerson: (name) => {
    const doc = state.documents.find((d) => d.id === state.selectedDocId);
    if (!doc) return;
    setDocumentAudience(doc, doc.audience.filter((a) => a !== name));
  },

  changeCategory: async (value) => {
    const id = state.selectedDocId;
    try {
      await api(`/api/documents/${id}/category`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: value }),
      });
      setState({ documents: state.documents.map((d) => (d.id === id ? { ...d, category: value } : d)) });
      toast('Category updated.', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  approveDoc: async (id) => {
    try {
      await api(`/api/documents/${id}/approve`, { method: 'POST' });
      toast('Document approved and indexed.', 'success');
      await loadForView('review');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  rejectDoc: async (id) => {
    const comment = prompt('Reason for rejection:', '');
    if (!comment?.trim()) return;
    try {
      await api(`/api/documents/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      toast('Document rejected.', 'success');
      await loadForView('review');
    } catch (e) {
      toast(e.message, 'error');
    }
  },
  toggleReviewFullscreen: () => setState({ docViewerFullscreen: !state.docViewerFullscreen }),
  downloadDoc: async (id) => {
    try {
      const url = await documentContentUrl(id);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      toast(e.message, 'error');
    }
  },

  demo: () => toast('Demo prototype — this would open the linked destination.'),
};

// ---------------------------------------------------------------------------
// Event delegation
// ---------------------------------------------------------------------------

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  // Checkboxes and selects act on `change`, not on click.
  if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type === 'checkbox')) return;
  // A click inside a modal card must not reach the backdrop's close action.
  const stop = e.target.closest('[data-stop]');
  if (stop && !stop.contains(el)) return;

  if (el.tagName === 'A' && (el.getAttribute('href') === '#' || el.dataset.act === 'demo')) e.preventDefault();
  const fn = actions[el.dataset.act];
  if (fn) fn(el.dataset.arg);
});

root.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'uploadFileInput' && el.files?.[0]) {
    const file = el.files[0];
    setState(state.newVersionDocId ? { uploadFile: file, newVersionName: file.name } : { uploadFile: file, uploadName: file.name });
    return;
  }
  const act = el.closest('[data-act]')?.dataset.act;
  if (!act || !actions[act]) return;
  if (el.tagName === 'SELECT') actions[act](el.value);
  else if (el.type === 'checkbox') actions[act](el.closest('[data-act]').dataset.arg);
});

// Text inputs write straight back into state so a repaint cannot lose them.
root.addEventListener('input', (e) => {
  const key = e.target.dataset.model;
  if (key) state[key] = e.target.value;
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
