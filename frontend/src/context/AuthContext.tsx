import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AuthUser, Role } from '../types';
import { api, setIdentity } from '../api/client';

interface AuthContextValue {
  user: AuthUser | null;
  signIn: (role: Role) => Promise<void>;
  signOut: () => void;
  signingIn: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = useCallback(async (role: Role) => {
    setSigningIn(true);
    setError(null);
    try {
      // Selecting a role switches which seeded identity the API sees. When the backend
      // moves to AUTH_MODE=entra this becomes a token exchange and the role arrives as
      // a claim instead — the rest of the app reads `user.role` either way.
      setIdentity(role);
      const me = await api.me();
      const [firstName = me.display_name, ...rest] = me.display_name.split(' ');
      setUser({
        firstName,
        lastName: rest.join(' '),
        name: me.display_name,
        initials: initials(me.display_name),
        role,
        title: [me.role, me.department].filter(Boolean).join(' · '),
        email: me.email,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in');
      throw e;
    } finally {
      setSigningIn(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, signIn, signOut: () => setUser(null), signingIn, error }),
    [user, signIn, signingIn, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
