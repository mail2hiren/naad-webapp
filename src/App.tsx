import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ClinicProvider } from './context/ClinicContext';
import ToastHost from './components/ToastHost';
import ProtectedRoute from './routes/ProtectedRoute';
import LoginView from './routes/LoginView';

// Each staff member only ever opens one or two workspaces, so each one is its
// own chunk, fetched on first visit, instead of shipping the whole app up front.
const ReceptionView = lazy(() => import('./routes/ReceptionView'));
const DoctorView = lazy(() => import('./routes/DoctorView'));
const InpatientWardView = lazy(() => import('./routes/InpatientWardView'));
const PharmacyView = lazy(() => import('./routes/PharmacyView'));
const PatientPortalView = lazy(() => import('./routes/PatientPortalView'));
const AdminView = lazy(() => import('./routes/AdminView'));

export default function App() {
  return (
    <AuthProvider>
      <ClinicProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ToastHost />
          <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-ink-faint text-sm">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<LoginView />} />
              <Route path="/reception" element={<ProtectedRoute allow={['receptionist']}><ReceptionView /></ProtectedRoute>} />
              <Route path="/doctor" element={<ProtectedRoute allow={['surgeon', 'physio']}><DoctorView /></ProtectedRoute>} />
              <Route path="/inpatient" element={<ProtectedRoute allow={['surgeon', 'physio', 'admin']}><InpatientWardView /></ProtectedRoute>} />
              <Route path="/pharmacy" element={<ProtectedRoute allow={['pharmacist']}><PharmacyView /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute allow={['admin']}><AdminView /></ProtectedRoute>} />
              {/* Patient Portal has its own, separate patient-account login (not the staff role dropdown). */}
              <Route path="/patient" element={<PatientPortalView />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ClinicProvider>
    </AuthProvider>
  );
}
