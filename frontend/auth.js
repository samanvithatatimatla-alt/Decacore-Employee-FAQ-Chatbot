// Microsoft Entra ID sign-in.
//
// This is inert until config.js supplies entra settings. With them absent the app
// keeps using the dev header, which is what AUTH_MODE=dev on the backend expects;
// with them present, "Sign in with Microsoft" acquires a real access token for the
// API and every request carries Authorization: Bearer.
//
// Deliberately flag-gated rather than switched on: the backend rejects tokens whose
// audience does not match ENTRA_AUDIENCE, so turning this on before the app
// registration exposes an API would lock everyone out of the deployed app.
//
// Turning it on needs three things done on the DecaCore-HR-Chatbot registration,
// none of which can be done from code — see docs/ENTRA_SETUP.md.

const MSAL_SRC = './vendor/msal-browser.min.js';

const cfg = () => (window.APP_CONFIG && window.APP_CONFIG.entra) || {};

export function entraEnabled() {
  const c = cfg();
  return Boolean(c.clientId && c.tenantId && c.scope);
}

let msalReady = null;
let instance = null;
let account = null;

// MSAL is 300KB. Load it only when Entra is actually configured, so dev mode does
// not pay for it.
function loadMsal() {
  if (msalReady) return msalReady;
  msalReady = new Promise((resolve, reject) => {
    if (window.msal) return resolve(window.msal);
    const el = document.createElement('script');
    el.src = MSAL_SRC;
    el.onload = () => (window.msal ? resolve(window.msal) : reject(new Error('MSAL failed to initialise')));
    el.onerror = () => reject(new Error('Could not load the Microsoft sign-in library'));
    document.head.appendChild(el);
  });
  return msalReady;
}

async function client() {
  if (instance) return instance;
  const msal = await loadMsal();
  const c = cfg();
  instance = new msal.PublicClientApplication({
    auth: {
      clientId: c.clientId,
      authority: `https://login.microsoftonline.com/${c.tenantId}`,
      redirectUri: window.location.origin,
    },
    // sessionStorage rather than localStorage: the token dies with the tab, which
    // suits a shared or kiosk machine better than persisting it.
    cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
  });
  await instance.initialize();
  return instance;
}

// Picks up an existing session on reload so the user is not asked to sign in twice.
export async function restore() {
  if (!entraEnabled()) return null;
  const app = await client();
  const accounts = app.getAllAccounts();
  account = accounts[0] || null;
  return account;
}

export async function signIn() {
  const app = await client();
  const result = await app.loginPopup({ scopes: [cfg().scope], prompt: 'select_account' });
  account = result.account;
  return account;
}

export async function accessToken() {
  if (!entraEnabled() || !account) return null;
  const app = await client();
  try {
    const result = await app.acquireTokenSilent({ scopes: [cfg().scope], account });
    return result.accessToken;
  } catch {
    // Silent acquisition fails on expiry or a consent change; fall back to a popup.
    const result = await app.acquireTokenPopup({ scopes: [cfg().scope] });
    account = result.account;
    return result.accessToken;
  }
}

export async function signOut() {
  account = null;
  if (!entraEnabled() || !instance) return;
  await instance.logoutPopup({ mainWindowRedirectUri: window.location.origin }).catch(() => {});
}

export const currentAccount = () => account;
