import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Welcome from './pages/Welcome';
import Home from './pages/Home';
import TripDashboard from './pages/TripDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';

// Protected route wrapper
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  
  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p role="status" className="text-muted">Opening your travel notebook…</p>
        </div>
      </main>
    );
  }
  
  if (!user) {
    return <Navigate
      to="/login"
      replace
      state={{ returnTo: `${location.pathname}${location.search}${location.hash}` }}
    />;
  }
  
  return <>{children}</>;
}

// Wrapper component to handle trip route with URL params
function TripRoute() {
  const { tripId } = useParams<{ tripId: string }>();
  if (!tripId) {
    return <Navigate to="/dashboard" replace />;
  }
  return <TripDashboard tripId={tripId} />;
}

function AppContent() {
  return (
    <div className="app-shell">
      <div>
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route 
            path="/home" 
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/trip/:tripId" 
            element={
              <ProtectedRoute>
                <TripRoute />
              </ProtectedRoute>
            } 
          />
        </Routes>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
