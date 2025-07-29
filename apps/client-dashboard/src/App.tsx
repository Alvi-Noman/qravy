import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuthContext } from './context/AuthContext';
import Dashboard from './pages/dashboard/index';
import Login from './pages/login';
import Signup from './pages/signup';
import { useEffect, useState } from 'react';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Allow time for AuthContext to rehydrate from localStorage
    const timer = setTimeout(() => setIsLoading(false), 100); // Slight delay for state sync
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLoading && !token) {
      navigate('/login', { replace: true, state: { from: location } });
    }
  }, [token, navigate, location, isLoading]);

  if (isLoading) return null; // Prevent render until state is ready

  return token ? <>{children}</> : null;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/" element={<Login />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;