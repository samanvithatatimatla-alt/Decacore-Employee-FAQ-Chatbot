import type { Role } from '../types';

/**
 * Where a user lands after signing in.
 *
 * HR admins work out of the dashboard, so dropping them on the chat screen meant a
 * navigation on every single sign-in. Employees still land on chat, which is the
 * whole app for them.
 *
 * Kept in one place because two callers decide this: the sign-in page (dev mode,
 * where the role is chosen client-side) and App's post-redirect effect (Entra, where
 * the tab navigates away and the sign-in page no longer exists to route anything).
 */
export function landingPath(role: Role): string {
  return role === 'hr_admin' ? '/admin' : '/chat';
}
