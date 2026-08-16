import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { ProtectedRoute, AdminRoute } from './routes/ProtectedRoute';
import AppShell from './components/layout/AppShell';
import WelcomePage from './pages/WelcomePage';
import SignInPage from './pages/SignInPage';
import ChatPage from './pages/ChatPage';
import ChatHistoryPage from './pages/ChatHistoryPage';
import ResourcesPage from './pages/ResourcesPage';
import ContactPage from './pages/ContactPage';
import DashboardPage from './pages/DashboardPage';
import DocumentsPage from './pages/DocumentsPage';
import DocumentViewerPage from './pages/DocumentViewerPage';
import InboxPage from './pages/InboxPage';

/**
 * Entra's redirect flow always returns to the app root, which renders the welcome page.
 * Without this a user who has just signed in lands back on a "get started" screen with
 * no sign of having signed in at all. Only redirects away from the two pre-auth routes,
 * so it never fights normal navigation.
 */
function useLandAfterSignIn() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (user && (pathname === '/' || pathname === '/signin')) {
      navigate('/chat', { replace: true });
    }
  }, [user, pathname, navigate]);
}

export default function App() {
  useLandAfterSignIn();
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/signin" element={<SignInPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/history" element={<ChatHistoryPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/contact" element={<ContactPage />} />

          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<DashboardPage />} />
            <Route path="/admin/inbox" element={<InboxPage />} />
            <Route path="/admin/documents" element={<DocumentsPage />} />
            <Route path="/admin/documents/:id" element={<DocumentViewerPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
