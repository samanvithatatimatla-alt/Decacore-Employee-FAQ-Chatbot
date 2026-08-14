// Welcome screen, sign-in screen, news ticker, top nav and sidebar.

import { shortDate } from './api.js';
import { icon } from './icons.js';
import { esc, isHrAdmin, state, userInitials, userName, userTitle } from './store.js';

const AVATAR = './img/bot-avatar.png';
export { AVATAR };

export function welcomeScreen() {
  return `
<div class="screen-center welcome-screen">
  <div class="hero-avatar"><div class="avatar-lg"><img src="${AVATAR}" alt="QBot bot"></div></div>
  <h1 class="brand-lg">QBot</h1>
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
    <div class="avatar-md"><img src="${AVATAR}" alt="QBot bot"></div>
    <h2 class="signin-title">Sign in to QBot</h2>
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
               data-model="signinEmail" data-focus-key="signinEmail" data-act-enter="signin"
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

// The ticker sits above the nav and runs on every screen inside the app. The CSS
// animates .ticker-track, and the items are duplicated so the loop has no visible
// seam when it wraps.
export function ticker() {
  if (!state.announcements.length) return '';
  const item = (a) =>
    `<span class="ticker-item"><span class="ticker-item-date">${esc(shortDate(a.published_at))}</span><strong>${esc(a.title)}</strong>${esc(a.body)}<span class="ticker-bullet"></span></span>`;
  const items = state.announcements.map(item).join('');
  return `
<div class="ticker">
  <span class="ticker-tag"><span class="ticker-dot"></span>BluePeak News</span>
  <div class="ticker-viewport">
    <div class="ticker-track">${items}${items}</div>
  </div>
</div>`;
}

export function topNav() {
  return `
<nav class="nav">
  <button class="burger" data-act="toggleSidebar" aria-label="Toggle sidebar"><span></span><span></span><span></span></button>
  <span class="brand">QBot</span>
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
  return `<button class="icon-btn ghost-icon ${active}" data-act="go" data-arg="${view}" title="${label}" aria-label="${label}">${icon(iconName, 16)}</button>`;
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
    <span class="recent-label" data-act="openConversation" data-arg="${esc(r.id)}" role="button">${esc(r.label)}</span>
  </div>`,
    )
    .join('')}
  <button class="update-link" data-act="go" data-arg="history" style="text-align:left;padding:6px 0 0">View all in Chat History →</button>
</div>`;
}

function userFooter(collapsed) {
  const menu = state.userMenuOpen ? '<div class="user-menu"><button data-act="signOut">Sign out</button></div>' : '';
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
  const hrTools = isHrAdmin();

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
        hrTools
          ? `<div class="side-nav" style="border-top:1px solid rgba(255,255,255,.08);padding-top:8px;margin-top:6px">
        <p class="nav-section-label">HR Tools</p>
        ${navItem('documents', 'Document Management', 'doc')}
        ${navItem('inbox', 'Employee Requests', 'mail')}
        ${navItem('dashboard', 'Dashboard', 'dashboard')}
      </div>`
          : ''
      }
      ${recentsBlock()}
    </div>
    <button class="side-nav-item connect-hr" style="border-top:1px solid rgba(255,255,255,.08);padding-top:12px;margin-top:auto" data-act="go" data-arg="contact"><span class="side-nav-icon">${icon('mail', 14)}</span>Connect to HR</button>
    ${userFooter(false)}`
    : `
    <button class="icon-btn" data-act="newChat" title="New chat" aria-label="New chat">+</button>
    ${collapsedItem('history', 'Chat History', 'chat')}
    ${collapsedItem('resources', 'Resources', 'folder')}
    ${
      hrTools
        ? collapsedItem('documents', 'Document Management', 'doc') +
          collapsedItem('inbox', 'Employee Requests', 'mail') +
          collapsedItem('dashboard', 'Dashboard', 'dashboard')
        : ''
    }
    <div class="spacer"></div>
    <button class="icon-btn ghost-icon connect-hr" data-act="go" data-arg="contact" title="Connect to HR" aria-label="Connect to HR">${icon('mail', 16)}</button>
    ${userFooter(true)}`;

  return `<aside class="sidebar" style="width:${open ? '250px' : '64px'};align-items:${open ? 'stretch' : 'center'}">${body}</aside>`;
}
