import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ClinicProvider } from './context/ClinicContext';
import ToastHost from './components/ToastHost';
import ProtectedRoute from './routes/ProtectedRoute';
import LoginView from './routes/LoginView';
import ReceptionView from './routes/ReceptionView';
import DoctorView from './routes/DoctorView';
import InpatientWardView from './routes/InpatientWardView';
import PharmacyView from './routes/PharmacyView';
import PatientPortalView from './routes/PatientPortalView';
import AdminView from './routes/AdminView';

export default function App() {
  return (
    <AuthProvider>
      <ClinicProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ToastHost />
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
        </BrowserRouter>
      </ClinicProvider>
    </AuthProvider>
  );
}
