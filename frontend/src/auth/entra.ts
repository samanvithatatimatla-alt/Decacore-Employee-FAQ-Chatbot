/**
 * Microsoft Entra ID sign-in.
 *
 * Inert until config.js supplies `entra` settings. With them absent the app keeps
 * using the dev header, which is what AUTH_MODE=dev on the backend expects; with
 * them present, "Sign in with Microsoft" acquires a real access token for the API
 * and every request carries `Authorization: Bearer`.
 *
 * Flag-gated rather than switched on: the backend rejects tokens whose audience does
 * not match ENTRA_AUDIENCE, so enabling this against a misconfigured registration
 * locks everyone out of the deployed app. See docs/ENTRA_SETUP.md.
 *
 * Ported from the pre-React frontend (commit c9e9ec3). The behaviour is deliberately
 * unchanged; only the module loading differs — MSAL now comes from npm and is
 * dynamically imported rather than vendored and injected as a <script> tag.
 */

import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';

export interface EntraConfig {
  clientId: string;
  tenantId: string;
  scope: string;
}

function cfg(): Partial<EntraConfig> {
  return window.APP_CONFIG?.entra ?? {};
}

/** All three values must be present — a half-filled config is treated as off. */
export function entraEnabled(): boolean {
  const c = cfg();
  return Boolean(c.clientId && c.tenantId && c.scope);
}

let instance: PublicClientApplication | null = null;
let initializing: Promise<PublicClientApplication> | null = null;
let account: AccountInfo | null = null;

async function client(): Promise<PublicClientApplication> {
  if (instance) return instance;
  // Kept as a single in-flight promise so two concurrent callers cannot each build an
  // instance and race `initialize()`.
  if (!initializing) {
    initializing = (async () => {
      // Dynamic import: MSAL is ~300KB, and dev mode never signs in with it. This keeps
      // it out of the main bundle so the app does not pay for a library it may not use.
      const msal = await import('@azure/msal-browser');
      const c = cfg();
      const app = new msal.PublicClientApplication({
        auth: {
          clientId: c.clientId!,
          authority: `https://login.microsoftonline.com/${c.tenantId}`,
          // Redirect flow returns to the app itself, which then completes the exchange
          // via handleRedirectPromise().
          redirectUri: window.location.origin,
          postLogoutRedirectUri: window.location.origin,
          // MSAL v5 dropped navigateToLoginRequestUrl. Landing back on the app root is
          // fine here: SignInPage routes to /chat as soon as the restored session
          // produces a user.
        },
        // sessionStorage rather than localStorage: the token dies with the tab, which
        // suits a shared or kiosk machine better than persisting it.
        //
        // The original also set storeAuthStateInCookie: false. MSAL v5 removed that
        // option from CacheOptions and false was its default, so dropping it changes
        // nothing.
        cache: { cacheLocation: 'sessionStorage' },
      });
      await app.initialize();
      instance = app;
      return app;
    })();
  }
  return initializing;
}

/**
 * Completes a redirect sign-in if we are returning from one, otherwise picks up an
 * existing session so a reload does not force a second sign-in.
 *
 * Must run on every load before anything reads the account: `handleRedirectPromise`
 * is what consumes the `#code=` fragment and exchanges it for tokens.
 */
export async function restore(): Promise<AccountInfo | null> {
  if (!entraEnabled()) return null;
  const app = await client();
  const result = await app.handleRedirectPromise();
  account = result?.account ?? app.getAllAccounts()[0] ?? null;
  if (account) app.setActiveAccount(account);
  return account;
}

/**
 * Starts sign-in by navigating the whole tab to Entra.
 *
 * Redirect rather than popup, deliberately. `loginPopup` depends on the opener keeping
 * a usable handle on the popup window, which browser popup blockers, "open in new tab"
 * settings and COOP headers can all break — and when it breaks the user authenticates
 * successfully and the app still hangs, with the response fragment stranded in a window
 * nothing is reading. Redirect has no window handle to lose. Note this never resolves:
 * the page is navigating away.
 */
export async function signIn(): Promise<void> {
  const app = await client();
  await app.loginRedirect({ scopes: [cfg().scope!], prompt: 'select_account' });
}

export async function accessToken(): Promise<string | null> {
  if (!entraEnabled() || !account) return null;
  const app = await client();
  try {
    const result = await app.acquireTokenSilent({ scopes: [cfg().scope!], account });
    return result.accessToken;
  } catch {
    // Silent acquisition fails on expiry or a consent change. Re-authenticate by
    // redirect for the same reason sign-in uses it — a popup here would strand the
    // user mid-request if the browser blocked it.
    await app.acquireTokenRedirect({ scopes: [cfg().scope!] });
    return null;
  }
}

export async function signOut(): Promise<void> {
  account = null;
  if (!entraEnabled() || !instance) return;
  await instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin }).catch(() => {});
}

export const currentAccount = (): AccountInfo | null => account;
