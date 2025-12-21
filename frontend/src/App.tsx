import { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Welcome from './pages/Welcome';
import Home from './pages/Home';
import TripDashboard from './pages/TripDashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import backgroundImage from './assets/images/backgrounds/background.jpg';

const STORAGE_KEY = 'currentTrip';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

// Wrapper component to handle trip route with URL params
function TripRoute({ setCurrentTrip }: { setCurrentTrip: (trip: { tripId: string; participantId: string }) => void }) {
  const { tripId } = useParams<{ tripId: string }>();
  const location = useLocation();
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!tripId) {
      setIsLoading(false);
      return;
    }

    // First, try to get participant ID from location state (passed from Dashboard)
    const stateParticipantId = (location.state as any)?.participantId;
    if (stateParticipantId) {
      setParticipantId(stateParticipantId);
      setCurrentTrip({ tripId, participantId: stateParticipantId });
      setIsLoading(false);
      return;
    }

    // Otherwise, check localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const tripData = JSON.parse(stored);
      if (tripData.tripId === tripId) {
        setParticipantId(tripData.participantId);
        setIsLoading(false);
        return;
      }
    }
    
    setIsLoading(false);
  }, [tripId, location, setCurrentTrip]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading trip...</p>
        </div>
      </div>
    );
  }

  if (!tripId || !participantId) {
    return <Navigate to="/dashboard" replace />;
  }

  return <TripDashboard tripId={tripId} participantId={participantId} />;
}

function AppContent() {
  const [currentTrip, setCurrentTrip] = useState<{ tripId: string; participantId: string } | null>(() => {
    // Initialize from localStorage on app load
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  });

  // Save to localStorage whenever currentTrip changes
  useEffect(() => {
    if (currentTrip) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentTrip));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [currentTrip]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 relative">
      {/* Background Image with Opacity */}
      <div 
        className="fixed inset-0 bg-cover bg-center bg-no-repeat opacity-20 pointer-events-none"
        style={{ 
          backgroundImage: `url(${backgroundImage})`,
          zIndex: 0
        }}
      />
      
      {/* Content */}
      <div className="relative z-10">
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route 
            path="/home" 
            element={
              <ProtectedRoute>
                <Home onTripJoin={setCurrentTrip} />
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
                <TripRoute setCurrentTrip={setCurrentTrip} />
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
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <AppContent />
      </Router>
    </AuthProvider>
  );
}

export default App;
