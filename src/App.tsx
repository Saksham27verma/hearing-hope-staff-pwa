import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth } from './firebase';
import { useAuthUser } from './hooks/useAuthUser';
import { AppointmentsProvider } from './context/AppointmentsContext';
import { setupPushNotifications } from './services/pushNotifications';
import LoginScreen from './screens/LoginScreen';
import AppointmentsScreen from './screens/AppointmentsScreen';
import AppointmentDetailScreen from './screens/AppointmentDetailScreen';
import ReceiptActionScreen from './screens/ReceiptActionScreen';

function StaffLayout({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <AppointmentsProvider userId={user.uid}>
      <Routes>
        <Route index element={<AppointmentsScreen onLogout={onLogout} />} />
        <Route path="visit/:id" element={<AppointmentDetailScreen />} />
        <Route path="receipt/:appointmentId" element={<ReceiptActionScreen />} />
      </Routes>
    </AppointmentsProvider>
  );
}

export default function App() {
  const { user, loading } = useAuthUser();

  useEffect(() => {
    if (user) {
      void setupPushNotifications().catch(() => {});
    }
  }, [user]);

  const handleLogout = () => {
    void signOut(auth);
  };

  if (loading) {
    return <div className="app-splash">Loading…</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/app" replace /> : <LoginScreen />} />
        <Route
          path="/app/*"
          element={
            user ? <StaffLayout user={user} onLogout={handleLogout} /> : <Navigate to="/login" replace />
          }
        />
        <Route path="/" element={<Navigate to={user ? '/app' : '/login'} replace />} />
        <Route path="*" element={<Navigate to={user ? '/app' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
