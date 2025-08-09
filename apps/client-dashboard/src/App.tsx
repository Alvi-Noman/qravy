import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuthContext } from './context/AuthContext';
import DashboardLayout from './layout/DashboardLayout';
import Dashboard from './pages/dashboard/index';
import Orders from './pages/dashboard/orders';
import Products from './pages/dashboard/products';
import Categories from './pages/dashboard/categories';
import Login from './pages/login';
import Signup from './pages/signup';
import MagicLink from './pages/magic-link';
import HomeRedirect from './pages/HomeRedirect';
import LoadingScreen from './components/LoadingScreen';

import CreateRestaurant from './pages/create-restaurant/CreateRestaurant';
import OnboardingWizard from './pages/restaurant/OnboardingWizard';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !token) {
      navigate('/login', { replace: true, state: { from: location } });
    }
  }, [token, navigate, location, loading]);

  if (loading) {
    return <LoadingScreen />;
  }

  return token ? <>{children}</> : null;
}

// Protect onboarding so only users who need onboarding can access it
function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    // If user is already onboarded, redirect to dashboard
    if (user && user.isOnboarded) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<Orders />} />
          <Route path="products" element={<Products />} />
          <Route path="categories" element={<Categories />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/magic-link" element={<MagicLink />} />
        <Route path="/create-restaurant" element={
          <RequireAuth>
            <CreateRestaurant />
          </RequireAuth>
        } />
        <Route path="/:restaurantUrl/welcome" element={
          <RequireAuth>
            <RequireOnboarding>
              <OnboardingWizard />
            </RequireOnboarding>
          </RequireAuth>
        } />
        <Route path="/" element={<HomeRedirect />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;