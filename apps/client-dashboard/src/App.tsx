import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuthContext } from './context/AuthContext';
import LoadingScreen from './components/LoadingScreen';

// Lazy-loaded pages/layout (match exact filenames)
const DashboardLayout = lazy(() => import('./layout/DashboardLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const Categories = lazy(() => import('./pages/Categories'));
const MenuItemsPage = lazy(() => import('./pages/MenuItems'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const MagicLink = lazy(() => import('./pages/MagicLink'));
const Verify = lazy(() => import('./pages/Verify'));
const HomeRedirect = lazy(() => import('./pages/HomeRedirect'));
const CreateRestaurant = lazy(() => import('./pages/CreateRestaurant'));
const OnboardingWizard = lazy(() => import('./pages/restaurant/OnboardingWizard'));

// NEW: Manage Categories page
const ManageCategories = lazy(() => import('./pages/ManageCategories'));

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, loading } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !token) {
      navigate('/login', { replace: true, state: { from: location } });
    }
  }, [token, navigate, location, loading]);

  if (loading) return <LoadingScreen />;
  return token ? <>{children}</> : null;
}

function RequireVerifiedAndOnboarded({ children }: { children: React.ReactNode }) {
  const { token, user, loading } = useAuthContext();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading) {
      if (!token) {
        navigate('/login', { replace: true, state: { from: location } });
      } else if (!user?.isVerified) {
        navigate('/login', { replace: true });
      } else if (!user?.isOnboarded) {
        navigate('/create-restaurant', { replace: true });
      }
    }
  }, [token, user, loading, navigate, location]);

  if (loading) return <LoadingScreen />;
  return token && user?.isVerified && user?.isOnboarded ? <>{children}</> : null;
}

function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.isOnboarded) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  return <>{children}</>;
}

function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <RequireVerifiedAndOnboarded>
                <DashboardLayout />
              </RequireVerifiedAndOnboarded>
            }
          >
            <Route index element={<Dashboard />} />
          </Route>

          <Route
            element={
              <RequireVerifiedAndOnboarded>
                <DashboardLayout />
              </RequireVerifiedAndOnboarded>
            }
          >
            <Route path="/orders" element={<Orders />} />
            <Route path="/menu-items" element={<MenuItemsPage />} />
            <Route path="/categories" element={<Categories />} />
            {/* NEW: manage categories route */}
            <Route path="/categories/manage" element={<ManageCategories />} />
          </Route>

          {/* Legacy redirects */}
          <Route path="/dashboard/orders" element={<Navigate to="/orders" replace />} />
          <Route path="/dashboard/menu-items" element={<Navigate to="/menu-items" replace />} />
          <Route path="/dashboard/categories" element={<Navigate to="/categories" replace />} />
          <Route path="/dashboard/categories/manage" element={<Navigate to="/categories/manage" replace />} />

          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/magic-link" element={<MagicLink />} />
          <Route path="/verify" element={<Verify />} />

          <Route
            path="/create-restaurant"
            element={
              <RequireAuth>
                <CreateRestaurant />
              </RequireAuth>
            }
          />
          <Route
            path="/:restaurantUrl/welcome"
            element={
              <RequireAuth>
                <RequireOnboarding>
                  <OnboardingWizard />
                </RequireOnboarding>
              </RequireAuth>
            }
          />

          <Route path="/" element={<HomeRedirect />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}

export default App;