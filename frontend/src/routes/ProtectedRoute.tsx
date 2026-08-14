import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/signin" replace />;
  return <Outlet />;
}

export function AdminRoute() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/signin" replace />;
  if (user.role !== 'hr_admin') return <Navigate to="/chat" replace />;
  return <Outlet />;
}
