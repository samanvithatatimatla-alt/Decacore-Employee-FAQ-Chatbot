import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, Role } from '../types';
import { api, setIdentity } from '../api/client';
import * as entra from '../auth/entra';

interface AuthContextValue {
  user: AuthUser | null;
  /** Dev-mode sign-in: picks which seeded identity the API sees. Unavailable under Entra. */
  signIn: (role: Role) => Promise<void>;
  /** Real Microsoft sign-in. Only meaningful when Entra is configured. */
  signInWithMicrosoft: () => Promise<void>;
  signOut: () => void;
  signingIn: boolean;
  /** True once config.js supplies clientId, tenantId and scope. */
  entraEnabled: boolean;
  /** True while an existing Entra session is being restored on first load. */
  restoring: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * The backend has four roles; this UI only distinguishes the HR admin experience from
 * everyone else. Manager and Executive are real backend roles with their own document
 * visibility, so they must map to `employee` here rather than being treated as unknown
 * and denied — the API still scopes what they can see.
 */
function toUiRole(apiRole: string): Role {
  return apiRole === 'HRAdmin' ? 'hr_admin' : 'employee';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [restoring, setRestoring] = useState(entra.entraEnabled());
  const [error, setError] = useState<string | null>(null);

  const entraEnabled = entra.entraEnabled();

  /** Builds the UI user from whatever identity the API reports for the current caller. */
  const loadMe = useCallback(async (roleOverride?: Role) => {
    const me = await api.me();
    const [firstName = me.display_name, ...rest] = me.display_name.split(' ');
    setUser({
      firstName,
      lastName: rest.join(' '),
      name: me.display_name,
      initials: initials(me.display_name),
      // Under Entra the role is whatever the token's `roles` claim resolved to, so it
      // comes back from the API rather than being chosen in the client.
      role: roleOverride ?? toUiRole(me.role),
      title: [me.role, me.department].filter(Boolean).join(' · '),
      email: me.email,
    });
  }, []);

  // Runs on every load when Entra is on. This both completes a redirect sign-in (it is
  // what consumes the `#code=` fragment) and restores an existing session after a
  // reload, so a refresh does not force signing in again.
  useEffect(() => {
    if (!entraEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const account = await entra.restore();
        if (account && !cancelled) await loadMe();
      } catch (e) {
        // Unlike a plain "no session yet", a failure here means the code exchange or
        // the /api/me call actually failed — the user has authenticated and still
        // cannot get in, so it must be visible rather than silently dropping them
        // back on the sign-in screen with no explanation.
        console.error('[entra] completing sign-in failed', e);
        if (!cancelled) {
          const code = (e as { errorCode?: string })?.errorCode ?? '';
          const message = e instanceof Error ? e.message : 'Could not complete sign-in';
          setError(code ? `${code}: ${message}` : message);
        }
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entraEnabled, loadMe]);

  const signIn = useCallback(
    async (role: Role) => {
      if (entraEnabled) throw new Error('Dev sign-in is disabled while Entra is configured');
      setSigningIn(true);
      setError(null);
      try {
        // Selecting a role switches which seeded identity the API sees. The chosen role
        // is authoritative here precisely because dev mode has no token to read it from.
        setIdentity(role);
        await loadMe(role);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not sign in');
        throw e;
      } finally {
        setSigningIn(false);
      }
    },
    [entraEnabled, loadMe],
  );

  const signInWithMicrosoft = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      // Navigates the tab to Entra and does not return. The session is completed by
      // the restore effect above when the browser comes back with the code, so there
      // is no loadMe() here — this component will have been torn down by then.
      await entra.signIn();
    } catch (e) {
      // Always log the raw error: MSAL failures are diagnosed by errorCode, and a
      // friendly message in its place makes them impossible to debug.
      console.error('[entra] sign-in failed', e);
      // MSAL errors carry a machine-readable errorCode; match on that rather than on
      // the human message, which varies by version and locale.
      const code = (e as { errorCode?: string })?.errorCode ?? '';
      const message = e instanceof Error ? e.message : 'Could not sign in';
      // Only a genuine popup dismissal is a cancellation. Everything else is a real
      // failure and must show its code, or a misconfiguration looks like user error.
      setError(code === 'user_cancelled' ? 'Sign-in was cancelled.' : `${code || 'error'}: ${message}`);
      throw e;
    } finally {
      setSigningIn(false);
    }
  }, [loadMe]);

  const signOut = useCallback(() => {
    setUser(null);
    if (entraEnabled) void entra.signOut();
  }, [entraEnabled]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, signIn, signInWithMicrosoft, signOut, signingIn, entraEnabled, restoring, error }),
    [user, signIn, signInWithMicrosoft, signOut, signingIn, entraEnabled, restoring, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
