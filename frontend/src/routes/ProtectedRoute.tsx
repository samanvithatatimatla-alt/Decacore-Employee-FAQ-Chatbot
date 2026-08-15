import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Under Entra, restoring a session from sessionStorage is async, so `user` is null for
 * the first few frames after a reload. Redirecting on that would bounce a signed-in
 * user to /signin and discard the session that was about to come back — so hold the
 * render until the restore settles. In dev mode `restoring` is false from the start
 * and this costs nothing.
 */
function useAuthGate() {
  const { user, restoring } = useAuth();
  return { user, restoring };
}

export function ProtectedRoute() {
  const { user, restoring } = useAuthGate();
  if (restoring) return null;
  if (!user) return <Navigate to="/signin" replace />;
  return <Outlet />;
}

export function AdminRoute() {
  const { user, restoring } = useAuthGate();
  if (restoring) return null;
  if (!user) return <Navigate to="/signin" replace />;
  if (user.role !== 'hr_admin') return <Navigate to="/chat" replace />;
  return <Outlet />;
}
