// Employee-facing views: chat home, the message thread, chat history, resources
// and the Connect to HR screen, plus the secure document viewer modal.

import { icon } from './icons.js';
import { HOME_SUGGESTIONS, POLICY_UPDATES, RECENTLY_VIEWED_FALLBACK, RESOURCE_FORMS, WATERMARK_ROWS } from './seed.js';
import { esc, state, userFirstName, userName, userTitle } from './store.js';
import { AVATAR, newsBanner } from './views-shell.js';

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function chatHome() {
  const suggestions = state.suggestions.length ? state.suggestions : HOME_SUGGESTIONS;
  return `
<div class="chat-home">
  ${newsBanner()}
  <div class="avatar-lg"><img src="${AVATAR}" alt="HR Bot"></div>
  <h2 class="home-greeting">Welcome, ${esc(userFirstName())}. How can I help you today?</h2>
  <p class="personalized-note">Answers and resources are personalized for your role — ${esc(userTitle())}.</p>
  <button class="feature-badge" data-act="goPolicyUpdates" style="cursor:pointer;font-family:'Hanken Grotesk',system-ui,sans-serif">${POLICY_UPDATES.length} policy updates →</button>
  <div class="home-composer">
    <input class="input" placeholder="Ask about vacation, expenses, leave…" value="${esc(state.homeDraft)}"
           data-model="homeDraft" data-focus-key="homeComposer" data-act-enter="sendHome">
    <button class="send" data-act="sendHome">Send</button>
  </div>
  <div style="display:flex;flex-direction:column;gap:22px;width:100%;max-width:680px;align-items:stretch">
    <div>
      <p class="faq-label">Top 3 Frequently Asked Questions</p>
      <div class="suggestions" style="max-width:none">
        ${suggestions
          .slice(0, 3)
          .map((q) => `<button class="chip" data-act="ask" data-arg="${esc(q)}">${esc(q)}</button>`)
          .join('')}
      </div>
    </div>
  </div>
</div>`;
}

function botCard(m) {
  const cardClass = m.kind === 'warn' ? 'warn' : m.kind === 'refuse' ? 'refuse' : '';
  const tags = m.tags || [];
  const showToggle = tags.length > 2;
  const visibleTags = m.sourcesExpanded || !showToggle ? tags : tags.slice(0, 2);
  const toggleLabel = m.sourcesExpanded ? 'Show less' : `+${tags.length - 2} more sources`;
  const steps = m.steps || [];
  const followUps = (m.followUps || []).slice(0, 3);
  const canEscalate = m.kind === 'warn' || m.kind === 'refuse';

  return `
<div class="bot-row">
  <div class="avatar"><img src="${AVATAR}" alt="HR Bot bot"></div>
  <div class="bot-col">
    <div class="bot-card ${cardClass}">
      <div class="card-kicker">${esc(m.kicker || 'Answer')}</div>
      ${steps.length ? '' : `<p class="card-body">${esc(m.body)}${m.streaming ? '<span class="stream-caret"></span>' : ''}</p>`}
      ${
        steps.length
          ? `<div style="display:flex;flex-direction:column;gap:10px;margin:2px 0 4px">
        ${steps
          .map(
            (t, i) => `<div style="display:flex;align-items:flex-start;gap:10px">
          <span style="flex:none;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;line-height:1">${i + 1}</span>
          <span style="flex:1;min-width:0;color:#fff;font-size:14px;line-height:1.55">${esc(t)}</span>
        </div>`,
          )
          .join('')}
      </div>`
          : ''
      }
      ${
        tags.length
          ? `<div class="tags">${visibleTags
              .map((t) => `<span class="tag">${esc(t)}</span>`)
              .join('')}</div>
        ${showToggle ? `<button class="sources-more-link" data-act="toggleSources" data-arg="${m.id}">${toggleLabel}</button>` : ''}`
          : ''
      }
      ${
        m.kind === 'refuse' && !tags.length
          ? '<p class="card-body" style="opacity:.7;font-size:12px;margin:0">No approved company policy matched this request.</p>'
          : ''
      }
      ${
        canEscalate && !m.streaming
          ? `<div class="hr-contact-actions">
        <button class="send-hr-btn" data-act="escalate" data-arg="${m.id}">${m.escalated ? 'Sent to HR ✓' : 'Connect to HR'}</button>
      </div>`
          : ''
      }
    </div>
    <div class="msg-actions">
      <button class="msg-action-btn" data-act="copy" data-arg="${m.id}" title="Copy" aria-label="Copy">
        ${state.copiedMessageId === m.id ? icon('check', 14) : icon('copy', 14)}
      </button>
    </div>
    ${
      followUps.length
        ? `<div class="followups">
      <p class="followups-label">Follow-up questions</p>
      <div class="followups-row">
        ${followUps.map((q) => `<button class="followup-chip" data-act="ask" data-arg="${esc(q)}">${esc(q)}</button>`).join('')}
      </div>
    </div>`
        : ''
    }
  </div>
</div>`;
}

export function chatThread() {
  return `
<div class="thread">
  <div class="thread-inner">
    ${newsBanner()}
    ${state.messages
      .map((m) =>
        m.role === 'user'
          ? `<div class="row user"><div class="bubble-user">${esc(m.text)}</div></div>`
          : botCard(m),
      )
      .join('')}
    ${
      state.isTyping
        ? `<div class="bot-row">
      <div class="avatar"><img src="${AVATAR}" alt="HR Bot bot"></div>
      <div class="typing-card"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
    </div>`
        : ''
    }
  </div>
</div>
<div class="composer">
  <input class="input" placeholder="Ask about vacation, expenses, leave…" value="${esc(state.homeDraft)}"
         data-model="homeDraft" data-focus-key="composer" data-act-enter="sendHome">
  <button class="send" data-act="sendHome">Send</button>
</div>
<p class="disclaimer">AI responses may be inaccurate. Please verify with official policy documents.</p>`;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function historyView() {
  const q = state.historyQuery.trim().toLowerCase();
  const groups = state.historyMode === 'empty'
    ? []
    : state.historyGroups
        .map((g) => ({ ...g, items: g.items.filter((h) => !q || h.label.toLowerCase().includes(q)) }))
        .filter((g) => g.items.length);
  const isEmpty = state.historyMode === 'empty' || !state.historyGroups.some((g) => g.items.length);

  return `
<div class="panel">
  <h1 class="admin-title">Chat History</h1>
  <p class="panel-sub" style="margin-top:4px">Conversations are automatically deleted after 7 days.</p>
  ${
    isEmpty
      ? `<div class="history-empty">
    <div class="history-empty-icon">${icon('chat', 28)}</div>
    <p class="history-empty-title">No conversations yet</p>
    <p class="history-empty-desc">Questions you ask the assistant will show up here.</p>
    <button class="history-empty-btn" data-act="newChat">Start a new chat</button>
  </div>`
      : `<div class="history-search-wrap">
    <span class="history-search-icon">${icon('search', 15)}</span>
    <input class="input history-search" placeholder="Search conversations…" value="${esc(state.historyQuery)}"
           data-model="historyQuery" data-focus-key="historySearch">
  </div>
  ${groups
    .map(
      (g) => `<p class="section-label">${esc(g.label)}</p>
    ${g.items
      .map(
        (h) => `<button class="history-row" data-act="openConversation" data-arg="${esc(h.id)}">
      <span class="history-icon">${icon('chat', 16)}</span>
      <span class="history-info"><span class="history-title">${esc(h.label)}</span></span>
      <span class="history-time">${esc(h.time)}</span>
      <span class="history-chevron">→</span>
    </button>`,
      )
      .join('')}`,
    )
    .join('')}
  ${groups.length ? '' : '<p class="panel-sub">No conversations match that search.</p>'}`
  }
</div>`;
}

// ---------------------------------------------------------------------------
// Connect to HR
// ---------------------------------------------------------------------------

const contactChip = (iconName, text) => `
<span style="display:flex;align-items:center;gap:7px;font-family:'Instrument Sans',system-ui,sans-serif;font-weight:600;font-size:13.5px;color:rgba(244,242,249,.85)">
  ${icon(iconName, 14, 'stroke="#b79cff"')}
  ${text}
</span>`;

export function contactView() {
  return `
<div class="contact-wrap">
  <h1 class="contact-title">Connect to HR</h1>
  <p class="contact-desc">Reach the HR team directly for anything the assistant couldn't answer, or for anything urgent.</p>
  <div class="contact-rail" style="margin:auto">
    <div class="contact-card rail-card">
      <div class="rail-icon-badge">${icon('headset', 21)}</div>
      <p class="rail-title">Need HR urgently?</p>
      <p class="rail-desc">Reach the team directly.</p>
      <div class="contact-actions">
        <a class="contact-btn-primary" href="mailto:hr@hrbot.com">Email HR</a>
        <a class="contact-btn-secondary" href="#" data-act="demo">Message on Teams</a>
      </div>
      <div style="width:100%;border-top:1px solid rgba(255,255,255,.09);margin-top:16px;padding-top:14px;display:flex;align-items:center;justify-content:center;gap:22px;flex-wrap:wrap">
        ${contactChip('envelope', 'hr@hrbot.com')}
        ${contactChip('phone', '(555) 019-2200')}
        ${contactChip('clock', 'Mon–Fri, 9am–6pm')}
      </div>
    </div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function favButton(key, extraClass = '') {
  const on = !!state.favorites[key];
  return `<button class="fav-btn ${on ? 'on' : ''} ${extraClass}" data-act="toggleFav" data-arg="${esc(key)}" title="Favorite" aria-label="Favorite">
    ${on ? icon('starFilled', 15) : icon('star', 15)}
  </button>`;
}

function updatesList() {
  return `
<p class="panel-sub" style="margin:0 0 14px">AI-generated summaries of what changed.</p>
<div class="updates" style="max-width:none">
  ${POLICY_UPDATES.map(
    (u) => `<div class="update-card">
    <div class="update-card-head">
      <p class="update-card-name">${esc(u.name)}</p>
      <span class="update-card-date">Updated ${esc(u.date)}</span>
    </div>
    <p class="update-card-summary">${esc(u.summary)}</p>
    <div class="update-card-actions">
      <button class="update-link" data-act="ask" data-arg="${esc(u.question)}">Ask about this →</button>
      <button class="update-link" data-act="compareUpdate" data-arg="${u.id}">Compare versions →</button>
    </div>
  </div>`,
  ).join('')}
</div>`;
}

export function resourcesView() {
  const filter = state.resourceFilter;
  const tab = (key, label) =>
    `<button class="filter-tab ${filter === key ? 'active' : ''}" data-act="setResFilter" data-arg="${key}">${label}</button>`;

  const policies = state.policies.filter((p) => filter === 'all' || state.favorites[`policy-${p.id}`]);
  const forms = RESOURCE_FORMS.filter((f) => filter === 'all' || state.favorites[`form-${f.id}`]);
  const recents = state.recentlyViewed.length ? state.recentlyViewed : RECENTLY_VIEWED_FALLBACK;

  return `
<div class="panel">
  <h1 class="admin-title">Resources</h1>
  <p class="panel-sub" style="margin:4px 0 0">Documents shown are scoped to your role and access permissions.</p>
  <div class="filter-tabs" style="margin:18px 0 14px">
    ${tab('all', 'All')}
    ${tab('favorites', 'Favorites')}
    ${tab('updates', 'Recently Updated Policies')}
  </div>
  ${
    filter === 'updates'
      ? updatesList()
      : `
  ${
    filter === 'all'
      ? `<p class="section-label">Recently viewed</p>
  <div class="recent-viewed-grid">
    ${recents
      .map(
        (rv) => `<button class="recent-viewed-card" ${rv.id ? `data-act="openPolicy" data-arg="${esc(rv.id)}"` : 'data-act="demo"'}>
      <span class="recent-viewed-name">${esc(rv.name)}</span>
      <span class="recent-viewed-time">${esc(rv.time)}</span>
    </button>`,
      )
      .join('')}
  </div>`
      : ''
  }
  <p class="section-label">Policies</p>
  <div class="policy-list" style="flex:none">
    ${policies
      .map(
        (p) => `<div class="policy-row">
      ${favButton(`policy-${p.id}`)}
      <div class="policy-info">
        <div class="policy-name">${esc(p.name)}</div>
        <div class="policy-meta">${esc(p.category)} · Updated ${esc(p.uploadedOn)}</div>
      </div>
      <button class="ghost" data-act="openPolicy" data-arg="${esc(p.id)}" style="padding:6px 10px">View →</button>
    </div>`,
      )
      .join('')}
    ${
      !policies.length
        ? `<p class="panel-sub" style="margin:0">${
            filter === 'favorites' ? 'No favorited policies yet' : 'No policies are visible to your role yet.'
          }</p>`
        : ''
    }
  </div>
  <p class="section-label">Forms</p>
  <div class="policy-list" style="flex:none">
    ${forms
      .map(
        (f) => `<div class="policy-row ${state.highlightFormId === f.id ? 'form-hl' : ''}">
      ${favButton(`form-${f.id}`)}
      <div class="policy-info">
        <div class="policy-name">${esc(f.name)}</div>
        <div class="policy-meta">${esc(f.meta)}</div>
      </div>
      <a class="ghost" href="#" data-act="demo" style="padding:6px 10px">Download ↓</a>
    </div>`,
      )
      .join('')}
    ${!forms.length ? '<p class="panel-sub" style="margin:0">No favorited forms yet</p>' : ''}
  </div>`
  }
</div>`;
}

// ---------------------------------------------------------------------------
// Secure document viewer
// ---------------------------------------------------------------------------

export function empDocModal() {
  if (!state.empDocOpen || !state.empSelectedDoc) return '';
  const doc = state.empSelectedDoc;
  const compare = state.empDocCompare ? POLICY_UPDATES.find((u) => u.id === doc.updateId) : null;
  const showingPrev = state.empDocCompare && state.empDocVersion === 'prev';
  const favKey = `policy-${doc.id}`;

  // A real document renders its PDF; the compare view and the seeded updates fall
  // back to the prototype's text page, which is all they ever had.
  const page = showingPrev
    ? `<div class="pdf-preview-title">${esc(compare?.previewTitle || doc.name)}</div>
       <p class="pdf-preview-body">${esc(compare?.prevBody || '')}</p>`
    : state.empDocBlobUrl
      ? `<iframe src="${state.empDocBlobUrl}" title="${esc(doc.name)}" style="width:100%;height:100%;border:0;background:#fff"></iframe>`
      : `<div class="pdf-preview-title">${esc(doc.previewTitle || doc.name)}</div>
         <p class="pdf-preview-body">${esc(doc.previewBody || 'Loading document…')}</p>`;

  return `
<div class="modal-backdrop" data-act="closeEmpDoc">
  <div class="modal-card" style="max-width:720px;padding:22px" data-stop>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <h2 class="modal-title">${esc(doc.name)}</h2>
      <button class="doc-viewer-download" data-act="closeEmpDoc" title="Close" aria-label="Close">${icon('close', 16)}</button>
    </div>
    ${
      compare
        ? `<div class="changed-strip">
      <p class="changed-strip-label">What changed</p>
      <p class="changed-strip-text">${esc(compare.summary)}</p>
    </div>
    <div class="version-pills">
      <button class="version-pill ${state.empDocVersion === 'current' ? 'active' : ''}" data-act="showVersion" data-arg="current">Current — ${esc(compare.date)}</button>
      <button class="version-pill ${state.empDocVersion === 'prev' ? 'active' : ''}" data-act="showVersion" data-arg="prev">Previous — ${esc(compare.prevDate)}</button>
    </div>`
        : ''
    }
    <div class="secure-badge">${icon('lock', 12)}Watermarked · access limited to your role · sharing disabled</div>
    <div class="doc-viewer ${state.empDocFullscreen ? 'fullscreen' : ''}">
      <div class="doc-viewer-toolbar">
        <span class="doc-viewer-filename">${icon('docSmall', 14)}${esc(doc.name)}</span>
        <span class="doc-viewer-toolbar-actions">
          ${favButton(favKey)}
          <button class="doc-viewer-download" data-act="toggleEmpFullscreen" title="Toggle full screen" aria-label="Toggle full screen">
            ${state.empDocFullscreen ? icon('collapse', 15) : icon('expand', 15)}
          </button>
        </span>
      </div>
      <div class="doc-viewer-page">
        <div class="doc-watermark">
          ${WATERMARK_ROWS.map(
            (w) => `<span style="top:${w.top};left:${w.left}">CONFIDENTIAL — ${esc(userName())}</span>`,
          ).join('')}
        </div>
        ${page}
      </div>
    </div>
  </div>
</div>`;
}
