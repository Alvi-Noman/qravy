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
import CompleteProfile from './pages/complete-profile';
import HomeRedirect from './pages/HomeRedirect';

function RequireProfile({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && (!user.name || !user.company)) {
      navigate('/complete-profile');
    }
  }, [user, navigate]);

  return <>{children}</>;
}

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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl font-bold">Loading...</div>
      </div>
    );
  }

  return token ? <RequireProfile>{children}</RequireProfile> : null;
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
        <Route path="/complete-profile" element={<CompleteProfile />} />
        <Route path="/" element={<HomeRedirect />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;