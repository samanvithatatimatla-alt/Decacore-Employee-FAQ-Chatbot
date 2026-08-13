// Welcome screen, sign-in screen, top nav and sidebar.

import { icon } from './icons.js';
import { ANNOUNCEMENTS } from './seed.js';
import { esc, isHrAdmin, state, userInitials, userName, userTitle } from './store.js';

const AVATAR = './img/bot-avatar.png';

export function welcomeScreen() {
  return `
<div class="screen-center welcome-screen">
  <div class="hero-avatar"><div class="avatar-lg"><img src="${AVATAR}" alt="HR Bot bot"></div></div>
  <h1 class="brand-lg">HR Bot</h1>
  <p class="tagline">Employee FAQ Assistant</p>
  <p class="desc">Ask about vacation, expenses, leave, and other policies — get instant answers with citations to the source document.</p>
  <div class="feature-badges">
    <span class="feature-badge">Sourced answers</span>
    <span class="feature-badge">Policy citations</span>
    <span class="feature-badge">Available 24/7</span>
  </div>
  <button class="cta" data-act="goSignin">Sign in to continue</button>
</div>`;
}

export function signinScreen() {
  const busy = state.signingIn;
  return `
<div class="screen-center signin-screen">
  <div class="signin-card">
    <div class="avatar-md"><img src="${AVATAR}" alt="HR Bot bot"></div>
    <h2 class="signin-title">Sign in to HR Bot</h2>
    <p class="signin-sub">Use your company account to continue</p>
    <button class="ms-btn" data-act="signin" ${busy ? 'disabled' : ''}>
      <span class="ms-logo"><span></span><span></span><span></span><span></span></span>
      ${busy ? 'Signing in…' : 'Sign in with Microsoft'}
    </button>
    <p class="ms-caption">Secure sign-in with Microsoft Entra ID</p>
    <div style="display:flex;align-items:center;gap:12px;margin:14px 0 6px">
      <div style="flex:1;height:1px;background:rgba(255,255,255,.12)"></div>
      <span style="font-family:'Instrument Sans',system-ui,sans-serif;font-size:11px;font-weight:600;letter-spacing:.08em;color:rgba(244,242,249,.4)">OR</span>
      <div style="flex:1;height:1px;background:rgba(255,255,255,.12)"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;text-align:left">
      <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:rgba(244,242,249,.62)">Email
        <input type="email" placeholder="you@company.com" value="${esc(state.signinEmail)}"
               data-model="signinEmail" data-focus-key="signinEmail"
               style="font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:13.5px;color:#f4f2f9;background:#241f30;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:11px 12px;box-sizing:border-box;width:100%;outline:none">
      </label>
      <label style="display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:rgba(244,242,249,.62)">Password
        <input type="password" placeholder="••••••••" data-focus-key="signinPassword"
               style="font-family:'Hanken Grotesk',system-ui,sans-serif;font-size:13.5px;color:#f4f2f9;background:#241f30;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:11px 12px;box-sizing:border-box;width:100%;outline:none">
      </label>
      <button class="cta" style="margin:4px 0 0;width:100%;padding:12px 0;font-size:14px" data-act="signin" ${busy ? 'disabled' : ''}>Sign in</button>
    </div>
    <button class="back-link" data-act="goWelcome">← Back to welcome</button>
  </div>
</div>`;
}

export function topNav() {
  return `
<nav class="nav">
  <button class="burger" data-act="toggleSidebar" aria-label="Toggle sidebar"><span></span><span></span><span></span></button>
  <span class="brand">HR Bot</span>
  <div class="dev-toggle">
    <span class="dev-toggle-label">Dev only</span>
    <select data-act="setRole" aria-label="Preview role (dev only)">
      <option value="employee"${state.role === 'employee' ? ' selected' : ''}>Employee</option>
      <option value="hr_admin"${state.role === 'hr_admin' ? ' selected' : ''}>HR Admin</option>
    </select>
    <span class="dev-toggle-divider"></span>
    <select data-act="setHistoryMode" aria-label="Chat history state (dev only)">
      <option value="populated"${state.historyMode === 'populated' ? ' selected' : ''}>History: Populated</option>
      <option value="empty"${state.historyMode === 'empty' ? ' selected' : ''}>History: Empty</option>
    </select>
  </div>
</nav>`;
}

function navItem(view, label, iconName) {
  const active = state.view === view ? 'active' : '';
  return `<button class="side-nav-item ${active}" data-act="go" data-arg="${view}"><span class="side-nav-icon">${
    iconName === 'dot' ? '●' : icon(iconName, 14)
  }</span>${label}</button>`;
}

function collapsedItem(view, label, iconName) {
  const active = state.view === view ? 'active' : '';
  return `<button class="icon-btn ghost-icon ${active}" data-act="go" data-arg="${view}" title="${label}" aria-label="${label}">${icon(
    iconName,
    16,
  )}</button>`;
}

function recentsBlock() {
  const empty = state.historyMode === 'empty' || !state.historyGroups.some((g) => g.items.length);
  const top2 = empty ? [] : state.historyGroups.flatMap((g) => g.items).slice(0, 2);
  return `
<div class="recents-block" style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:6px">
  <p class="kicker">Recents</p>
  <p class="note">Chats delete after 7 days</p>
  ${empty ? '<p class="recents-empty">No recent chats</p>' : ''}
  ${top2
    .map(
      (r) => `<div class="recent">
    <a class="recent-label" href="#" data-act="openConversation" data-arg="${esc(r.id)}">${esc(r.label)}</a>
  </div>`,
    )
    .join('')}
  <button class="update-link" data-act="go" data-arg="history" style="text-align:left;padding:6px 0 0">View all in Chat History →</button>
</div>`;
}

function userFooter(collapsed) {
  const menu = state.userMenuOpen
    ? `<div class="user-menu"><button data-act="signOut">Sign out</button></div>`
    : '';
  if (collapsed) {
    return `<div class="sidebar-footer">${menu}
      <button class="icon-btn" style="font-size:12px" data-act="toggleUserMenu" title="${esc(userName())}" aria-label="Account menu">${esc(userInitials())}</button>
    </div>`;
  }
  return `<div class="sidebar-footer">${menu}
    <button class="user-row" data-act="toggleUserMenu">
      <span class="user-badge">${esc(userInitials())}</span>
      <span class="user">${esc(userName())}<br><span class="user-role-sub">${esc(userTitle())}</span></span>
    </button>
  </div>`;
}

export function sidebar() {
  const open = state.sidebarOpen;
  const width = open ? '250px' : '64px';
  const align = open ? 'stretch' : 'center';

  const body = open
    ? `
    <button class="btn-primary" data-act="newChat">New chat</button>
    <div class="side-scroll">
      <div class="side-nav">
        ${navItem('chat', 'Chat', 'dot')}
        ${navItem('history', 'Chat History', 'chat')}
        ${navItem('resources', 'Resources', 'folder')}
      </div>
      ${
        isHrAdmin()
          ? `<div class="side-nav" style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:6px">
        <p class="nav-section-label">HR Tools</p>
        ${navItem('documents', 'Document Management', 'doc')}
        ${navItem('dashboard', 'Dashboard', 'dashboard')}
      </div>`
          : ''
      }
      ${recentsBlock()}
    </div>
    <button class="side-nav-item connect-hr" style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;margin-top:auto" data-act="go" data-arg="contact"><span class="side-nav-icon">${icon(
      'mail',
      14,
    )}</span>Connect to HR</button>
    ${userFooter(false)}`
    : `
    <button class="icon-btn" data-act="newChat" title="New chat" aria-label="New chat">+</button>
    ${collapsedItem('history', 'Chat History', 'chat')}
    ${collapsedItem('resources', 'Resources', 'folder')}
    ${isHrAdmin() ? collapsedItem('documents', 'Document Management', 'doc') + collapsedItem('dashboard', 'Dashboard', 'dashboard') : ''}
    <div class="spacer"></div>
    <button class="icon-btn ghost-icon connect-hr" data-act="go" data-arg="contact" title="Connect to HR" aria-label="Connect to HR">${icon(
      'mail',
      16,
    )}</button>
    ${userFooter(true)}`;

  return `<aside class="sidebar" style="width:${width};align-items:${align}">${body}</aside>`;
}

// The announcements strip, shown above both the chat home and the thread.
export function newsBanner() {
  if (state.newsDismissed) {
    return `<button class="news-pill" data-act="restoreNews">
      <span class="news-pill-icon">${icon('megaphone', 13)}</span>${ANNOUNCEMENTS.length} updates
    </button>`;
  }
  const body = state.newsExpanded
    ? `${ANNOUNCEMENTS.map(
        (a) => `<div class="news-item">
        <p class="news-item-date">${esc(a.date)}</p>
        <p class="news-banner-text"><strong>${esc(a.headline)}</strong> ${esc(a.detail)}</p>
      </div>`,
      ).join('')}
      <button class="news-banner-link" data-act="collapseNews">Collapse</button>`
    : `<p class="news-banner-text"><strong>${esc(ANNOUNCEMENTS[0].headline)}</strong> ${esc(ANNOUNCEMENTS[0].detail)}</p>
       ${
         ANNOUNCEMENTS.length > 1
           ? `<button class="news-banner-link" data-act="expandNews">+${ANNOUNCEMENTS.length - 1} more updates</button>`
           : ''
       }`;

  return `
<div class="news-banner">
  <span class="news-banner-icon">${icon('megaphone', 16)}</span>
  <div class="news-banner-main">${body}</div>
  <button class="news-banner-dismiss" data-act="dismissNews" title="Dismiss" aria-label="Dismiss">${icon('close', 14)}</button>
</div>`;
}

export { AVATAR };
