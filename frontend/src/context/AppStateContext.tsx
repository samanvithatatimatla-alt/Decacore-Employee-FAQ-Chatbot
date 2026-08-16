import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react';
import type {
  AdminDoc,
  Announcement,
  ChatMessage,
  Citation,
  Conversation,
  FormDoc,
  PolicyDoc,
  PolicyUpdate,
  RecentlyViewedDoc,
  TopQuestion,
} from '../types';
import { api, files, streamChat, type ApiCharts } from '../api/client';
import {
  mapAdminDoc,
  mapAnnouncement,
  mapCitation,
  mapConversation,
  mapDocument,
  mapForm,
  mapMessage,
  mapPolicyUpdate,
  mapSavedToRecentlyViewed,
  mapTopQuestion,
} from '../api/map';
import { useAuth } from './AuthContext';

export type ResourceFilter = 'all' | 'favorites' | 'updates';

export interface MostReferenced {
  rank: number;
  name: string;
  citations: number;
}

interface AppState {
  chat: {
    messages: ChatMessage[];
    isTyping: boolean;
    chatStarted: boolean;
    nextMessageId: number;
    /** Server conversation id for the thread on screen; null until the first reply. */
    conversationId: string | null;
    error: string | null;
  };
  history: {
    conversations: Conversation[];
    nextConvId: number;
    search: string;
  };
  recents: { id: number; label: string }[];
  resources: {
    policies: PolicyDoc[];
    forms: FormDoc[];
    recentlyViewed: RecentlyViewedDoc[];
    policyUpdates: PolicyUpdate[];
    filter: ResourceFilter;
    search: string;
    highlightFormId: number | null;
  };
  adminDocuments: AdminDoc[];
  announcements: { items: Announcement[] };
  topQuestions: TopQuestion[];
  mostReferenced: MostReferenced[];
  /** Escalations waiting on HR. Drives the inbox badge; HR-only, 0 for everyone else. */
  pendingRequests: number;
  loading: boolean;
  ui: { sidebarOpen: boolean };
}

const initialState: AppState = {
  chat: { messages: [], isTyping: false, chatStarted: false, nextMessageId: 1, conversationId: null, error: null },
  history: { conversations: [], nextConvId: 1, search: '' },
  recents: [],
  resources: {
    policies: [],
    forms: [],
    recentlyViewed: [],
    policyUpdates: [],
    filter: 'all',
    search: '',
    highlightFormId: null,
  },
  adminDocuments: [],
  announcements: { items: [] },
  topQuestions: [],
  mostReferenced: [],
  pendingRequests: 0,
  loading: false,
  ui: { sidebarOpen: true },
};

interface HydratePayload {
  policies: PolicyDoc[];
  forms: FormDoc[];
  recentlyViewed: RecentlyViewedDoc[];
  policyUpdates: PolicyUpdate[];
  conversations: Conversation[];
  announcements: Announcement[];
  topQuestions: TopQuestion[];
  adminDocuments: AdminDoc[];
  mostReferenced: MostReferenced[];
  pendingRequests: number;
}

type Action =
  | { type: 'HYDRATE'; data: Partial<HydratePayload> }
  | { type: 'SET_LOADING'; value: boolean }
  | { type: 'SEND_MESSAGE'; text: string }
  | { type: 'START_BOT_REPLY' }
  | { type: 'APPEND_DELTA'; text: string }
  | { type: 'FINISH_BOT_REPLY'; citations: Citation[]; tags: string[]; escalationOffered: boolean; messageApiId: string }
  | { type: 'SET_CONVERSATION_ID'; id: string }
  | { type: 'CHAT_ERROR'; message: string }
  | { type: 'NEW_CHAT' }
  | { type: 'RESTORE_CONVERSATION'; convId: number; messages?: ChatMessage[] }
  | { type: 'TOGGLE_SOURCES'; messageId: number }
  | { type: 'MARK_ESCALATION_SENT'; messageId: number }
  | { type: 'SET_HISTORY_SEARCH'; value: string }
  | { type: 'SET_RESOURCE_FILTER'; filter: ResourceFilter }
  | { type: 'SET_RESOURCE_SEARCH'; value: string }
  | { type: 'TOGGLE_FAVORITE'; key: 'policy' | 'form'; id: number }
  | { type: 'MARK_RECENTLY_VIEWED'; id: number; name: string }
  | { type: 'SET_HIGHLIGHT_FORM'; formId: number | null }
  | { type: 'DELETE_ADMIN_DOC'; id: number }
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR'; open: boolean };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'HYDRATE': {
      const d = action.data;
      return {
        ...state,
        resources: {
          ...state.resources,
          policies: d.policies ?? state.resources.policies,
          forms: d.forms ?? state.resources.forms,
          recentlyViewed: d.recentlyViewed ?? state.resources.recentlyViewed,
          policyUpdates: d.policyUpdates ?? state.resources.policyUpdates,
        },
        history: { ...state.history, conversations: d.conversations ?? state.history.conversations },
        recents: (d.conversations ?? state.history.conversations)
          .slice(0, 5)
          .map((c) => ({ id: c.id, label: c.label })),
        announcements: { items: d.announcements ?? state.announcements.items },
        topQuestions: d.topQuestions ?? state.topQuestions,
        adminDocuments: d.adminDocuments ?? state.adminDocuments,
        mostReferenced: d.mostReferenced ?? state.mostReferenced,
        pendingRequests: d.pendingRequests ?? state.pendingRequests,
      };
    }
    case 'SET_LOADING':
      return { ...state, loading: action.value };

    case 'SEND_MESSAGE': {
      const userMsg: ChatMessage = { id: state.chat.nextMessageId, role: 'user', text: action.text };
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: [...state.chat.messages, userMsg],
          nextMessageId: state.chat.nextMessageId + 1,
          isTyping: true,
          chatStarted: true,
          error: null,
        },
      };
    }
    case 'START_BOT_REPLY': {
      // An empty bot bubble is appended up front so streamed deltas have somewhere to
      // land and the answer appears to type itself, rather than arriving in one jump.
      const botMsg: ChatMessage = { id: state.chat.nextMessageId, role: 'bot', body: '', kind: 'answer' };
      return {
        ...state,
        chat: { ...state.chat, messages: [...state.chat.messages, botMsg], nextMessageId: state.chat.nextMessageId + 1 },
      };
    }
    case 'APPEND_DELTA': {
      const messages = [...state.chat.messages];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'bot') return state;
      messages[messages.length - 1] = { ...last, body: (last.body ?? '') + action.text };
      return { ...state, chat: { ...state.chat, messages } };
    }
    case 'FINISH_BOT_REPLY': {
      const messages = [...state.chat.messages];
      const idx = messages.length - 1;
      const last = messages[idx];
      if (!last || last.role !== 'bot') return { ...state, chat: { ...state.chat, isTyping: false } };
      const body = last.body ?? '';
      messages[idx] = {
        ...last,
        apiId: action.messageApiId,
        citations: action.citations,
        tags: action.tags,
        escalated: action.escalationOffered,
        // `escalation_offered` is the backend saying it could not answer, which is
        // exactly what the refuse card means. Keying off "no citations" instead was
        // wrong: a greeting is answered correctly and cites nothing, so it came back
        // dressed as a failure with a Send-to-HR button.
        kind: action.escalationOffered ? 'refuse' : 'answer',
        body,
      };
      return { ...state, chat: { ...state.chat, messages, isTyping: false } };
    }
    case 'SET_CONVERSATION_ID':
      return { ...state, chat: { ...state.chat, conversationId: action.id } };
    case 'CHAT_ERROR': {
      // Replace the empty streaming bubble rather than leaving a blank card behind.
      const messages = [...state.chat.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'bot' && !last.body) {
        messages[messages.length - 1] = { ...last, kind: 'refuse', body: action.message };
      }
      return { ...state, chat: { ...state.chat, messages, isTyping: false, error: action.message } };
    }

    case 'NEW_CHAT':
      // History comes from the server, so nothing is archived locally here; the
      // conversation already exists server-side the moment the first reply lands.
      return {
        ...state,
        chat: { ...initialState.chat, nextMessageId: state.chat.nextMessageId },
      };
    case 'RESTORE_CONVERSATION': {
      const conv = state.history.conversations.find((c) => c.id === action.convId);
      if (!conv) return state;
      const messages = action.messages ?? conv.messages;
      return {
        ...state,
        chat: { ...state.chat, messages, chatStarted: true, conversationId: conv.apiId ?? null, error: null },
        history: {
          ...state.history,
          conversations: state.history.conversations.map((c) => (c.id === action.convId ? { ...c, messages } : c)),
        },
      };
    }
    case 'TOGGLE_SOURCES':
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.map((m) =>
            m.id === action.messageId ? { ...m, sourcesExpanded: !m.sourcesExpanded } : m,
          ),
        },
      };
    case 'MARK_ESCALATION_SENT':
      return {
        ...state,
        chat: {
          ...state.chat,
          messages: state.chat.messages.map((m) =>
            m.id === action.messageId ? { ...m, escalationSent: true } : m,
          ),
        },
      };
    case 'SET_HISTORY_SEARCH':
      return { ...state, history: { ...state.history, search: action.value } };
    case 'SET_RESOURCE_FILTER':
      return { ...state, resources: { ...state.resources, filter: action.filter } };
    case 'SET_RESOURCE_SEARCH':
      return { ...state, resources: { ...state.resources, search: action.value } };
    case 'TOGGLE_FAVORITE': {
      // Optimistic: the API call is fired alongside this and the list is refetched if
      // it fails, so the star responds immediately instead of after a round trip.
      if (action.key === 'policy') {
        return {
          ...state,
          resources: {
            ...state.resources,
            policies: state.resources.policies.map((p) => (p.id === action.id ? { ...p, favorite: !p.favorite } : p)),
          },
        };
      }
      return {
        ...state,
        resources: {
          ...state.resources,
          forms: state.resources.forms.map((f) => (f.id === action.id ? { ...f, favorite: !f.favorite } : f)),
        },
      };
    }
    case 'MARK_RECENTLY_VIEWED': {
      const withoutExisting = state.resources.recentlyViewed.filter((r) => r.id !== action.id);
      const apiId = state.resources.policies.find((p) => p.id === action.id)?.apiId;
      const entry: RecentlyViewedDoc = { id: action.id, apiId, name: action.name, time: 'Viewed just now' };
      return { ...state, resources: { ...state.resources, recentlyViewed: [entry, ...withoutExisting].slice(0, 6) } };
    }
    case 'SET_HIGHLIGHT_FORM':
      return { ...state, resources: { ...state.resources, highlightFormId: action.formId } };
    case 'DELETE_ADMIN_DOC':
      return { ...state, adminDocuments: state.adminDocuments.filter((d) => d.id !== action.id) };
    case 'TOGGLE_SIDEBAR':
      return { ...state, ui: { ...state.ui, sidebarOpen: !state.ui.sidebarOpen } };
    case 'SET_SIDEBAR':
      return { ...state, ui: { ...state.ui, sidebarOpen: action.open } };
    default:
      return state;
  }
}

interface AppStateContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  sendMessage: (text: string) => void;
  mostReferenced: MostReferenced[];
  openDocument: (id: number) => void;
  openForm: (id: number) => void;
  refresh: () => Promise<void>;
  uploadDocument: (file: File) => Promise<void>;
  uploadNewVersion: (id: number, file: File, summary: string) => Promise<void>;
  deleteDocument: (id: number) => Promise<void>;
  restoreConversation: (convId: number) => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { user } = useAuth();
  const abortRef = useRef<AbortController | null>(null);

  const loadEmployeeData = useCallback(async () => {
    const [docsRes, formsRes, favRes, recentRes, updatesRes, convRes, annRes, faqRes] = await Promise.all([
      api.documents().catch(() => ({ items: [], total: 0 })),
      api.forms().catch(() => ({ items: [], total: 0 })),
      api.favorites().catch(() => ({ items: [], total: 0 })),
      api.recentlyViewed().catch(() => ({ items: [], total: 0 })),
      api.documentUpdates().catch(() => ({ items: [], total: 0 })),
      api.conversations().catch(() => ({ items: [], total: 0 })),
      api.announcements().catch(() => ({ items: [], total: 0 })),
      api.topFaq().catch(() => ({ items: [], total: 0 })),
    ]);

    const favouriteIds = new Set(favRes.items.map((f) => f.document_id));
    dispatch({
      type: 'HYDRATE',
      data: {
        policies: docsRes.items.map((d) => mapDocument(d, favouriteIds.has(d.id))),
        forms: formsRes.items.map((f) => mapForm(f, favouriteIds.has(f.id))),
        recentlyViewed: recentRes.items.map(mapSavedToRecentlyViewed),
        policyUpdates: updatesRes.items.map(mapPolicyUpdate),
        conversations: convRes.items.map((c) => mapConversation(c)),
        announcements: annRes.items.map(mapAnnouncement),
        topQuestions: faqRes.items.map(mapTopQuestion),
      },
    });
  }, []);

  const loadAdminData = useCallback(async () => {
    const [docsRes, chartsRes, metricsRes] = await Promise.all([
      api.documents().catch(() => ({ items: [], total: 0 })),
      api.charts().catch(
        (): ApiCharts => ({ requests_by_status: [], documents_by_category: [], top_questions: [], most_referenced: [] }),
      ),
      api.metrics().catch(() => null),
    ]);

    // Version history is per-document, so it is fetched alongside rather than in a
    // second render pass — the admin list shows the version count immediately.
    const withVersions = await Promise.all(
      docsRes.items.map(async (d) => {
        const versions = await api.documentVersions(d.id).catch(() => ({ items: [], total: 0 }));
        return mapAdminDoc(d, versions.items);
      }),
    );

    dispatch({
      type: 'HYDRATE',
      data: {
        adminDocuments: withVersions,
        // Real citation counts per document. documents_by_category was only ever a
        // stand-in — it counted documents per category, which is a different thing
        // wearing the same label.
        mostReferenced: (chartsRes.most_referenced ?? []).slice(0, 5).map((m) => ({
          rank: m.rank,
          name: m.title || m.name,
          citations: m.citations,
        })),
        pendingRequests: metricsRes?.pending_requests ?? 0,
      },
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!user) return;
    dispatch({ type: 'SET_LOADING', value: true });
    try {
      await loadEmployeeData();
      if (user.role === 'hr_admin') await loadAdminData();
    } finally {
      dispatch({ type: 'SET_LOADING', value: false });
    }
  }, [user, loadEmployeeData, loadAdminData]);

  // Data is per-identity (role filtering happens server-side), so it reloads whenever
  // the signed-in user changes rather than once at mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      dispatch({ type: 'SEND_MESSAGE', text: trimmed });
      dispatch({ type: 'START_BOT_REPLY' });

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      void streamChat(
        trimmed,
        state.chat.conversationId,
        {
          onMeta: (m) => dispatch({ type: 'SET_CONVERSATION_ID', id: m.conversation_id }),
          onDelta: (t) => dispatch({ type: 'APPEND_DELTA', text: t }),
          onDone: (d) => {
            dispatch({
              type: 'FINISH_BOT_REPLY',
              citations: d.citations.map(mapCitation),
              tags: d.citations.map((c) => c.title),
              escalationOffered: d.escalation_offered,
              messageApiId: d.message_id,
            });
            // The conversation list only changes once a reply exists, so refresh
            // history here rather than on every keystroke.
            void api
              .conversations()
              .then((r) => dispatch({ type: 'HYDRATE', data: { conversations: r.items.map((c) => mapConversation(c)) } }))
              .catch(() => undefined);
          },
        },
        controller.signal,
      ).catch((e) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: 'CHAT_ERROR',
          message: e instanceof Error ? e.message : 'The assistant is unavailable right now.',
        });
      });
    },
    [state.chat.conversationId],
  );

  const restoreConversation = useCallback(
    async (convId: number) => {
      const conv = state.history.conversations.find((c) => c.id === convId);
      if (!conv?.apiId) return;
      const detail = await api.conversation(conv.apiId).catch(() => null);
      dispatch({
        type: 'RESTORE_CONVERSATION',
        convId,
        messages: detail ? detail.messages.map(mapMessage) : [],
      });
    },
    [state.history.conversations],
  );

  /**
   * Resolving the PDF's URL is asynchronous (see `files` in api/client), but opening
   * a tab after an await is treated as an unsolicited popup and blocked. So the tab
   * is opened synchronously inside the click and navigated once the URL arrives; on
   * failure it shows the reason rather than being left on a blank about:blank.
   *
   * `noopener` is deliberately absent here — with it, window.open returns null and
   * there is no handle to navigate. The tab is same-origin (or a SAS URL on our own
   * storage account), so `opener` access is not a concern.
   */
  const openInTab = useCallback(async (resolve: () => Promise<string>) => {
    const tab = window.open('', '_blank');
    try {
      const url = await resolve();
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Unknown error';
      if (tab) tab.document.write(`<p style="font:14px system-ui;padding:24px">Could not open this document — ${reason}</p>`);
    }
  }, []);

  const openDocument = useCallback(
    (id: number) => {
      const doc = state.resources.policies.find((p) => p.id === id);
      if (!doc?.apiId) return;
      void openInTab(() => files.documentOpenUrl(doc.apiId!));
      void api.markViewed(doc.apiId).catch(() => undefined);
    },
    [state.resources.policies, openInTab],
  );

  const openForm = useCallback(
    (id: number) => {
      const form = state.resources.forms.find((f) => f.id === id);
      if (!form?.apiId) return;
      void openInTab(() => files.formOpenUrl(form.apiId!));
    },
    [state.resources.forms, openInTab],
  );

  const uploadDocument = useCallback(
    async (file: File) => {
      await api.uploadDocument(file);
      await refresh();
    },
    [refresh],
  );

  const uploadNewVersion = useCallback(
    async (id: number, file: File, summary: string) => {
      const doc = state.adminDocuments.find((d) => d.id === id);
      if (!doc?.apiId) return;
      await api.uploadVersion(doc.apiId, file, summary);
      await refresh();
    },
    [state.adminDocuments, refresh],
  );

  const deleteDocument = useCallback(
    async (id: number) => {
      const doc = state.adminDocuments.find((d) => d.id === id);
      if (!doc?.apiId) return;
      dispatch({ type: 'DELETE_ADMIN_DOC', id });
      await api.deleteDocument(doc.apiId).catch(() => undefined);
      await refresh();
    },
    [state.adminDocuments, refresh],
  );

  // Favourites write through to the API; the reducer has already flipped the star.
  const dispatchWithEffects = useCallback<React.Dispatch<Action>>(
    (action) => {
      dispatch(action);
      if (action.type === 'TOGGLE_FAVORITE') {
        const list = action.key === 'policy' ? state.resources.policies : state.resources.forms;
        const item = list.find((x) => x.id === action.id);
        if (item?.apiId) {
          const call = item.favorite ? api.removeFavorite : api.addFavorite;
          void call(item.apiId).catch(() => void refresh());
        }
      }
      if (action.type === 'MARK_RECENTLY_VIEWED') {
        const doc = state.resources.policies.find((p) => p.id === action.id);
        if (doc?.apiId) void api.markViewed(doc.apiId).catch(() => undefined);
      }
    },
    [state.resources.policies, state.resources.forms, refresh],
  );

  return (
    <AppStateContext.Provider
      value={{
        state,
        dispatch: dispatchWithEffects,
        sendMessage,
        mostReferenced: state.mostReferenced,
        openDocument,
        openForm,
        refresh,
        uploadDocument,
        uploadNewVersion,
        deleteDocument,
        restoreConversation,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
