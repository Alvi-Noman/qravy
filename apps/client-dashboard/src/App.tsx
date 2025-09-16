/**
 * App entry with Auth + Progress providers and Toaster.
 */
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuthContext } from './context/AuthContext';
import LoadingScreen from './components/LoadingScreen';
import { ProgressProvider } from './context/ProgressContext';
import { Toaster } from './components/Toaster';

// IMPORTANT: import layouts synchronously to avoid first-visit layout jump
import DashboardLayout from './layout/DashboardLayout';
import SettingsLayout from './layout/SettingsLayout';

// Lazy-loaded pages
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
const Onboarding = lazy(() => import('./pages/Onboarding'));
const ManageCategories = lazy(() => import('./pages/ManageCategories'));

// Settings pages
const SettingsOverview = lazy(() => import('./pages/settings/index'));
const SettingsBranding = lazy(() => import('./pages/settings/Branding'));
const SettingsDomain = lazy(() => import('./pages/settings/Domain'));
const SettingsSecurity = lazy(() => import('./pages/settings/Security'));
const SettingsNotifications = lazy(() => import('./pages/settings/Notifications'));
const SettingsIntegrations = lazy(() => import('./pages/settings/Integrations'));
const SettingsDeveloper = lazy(() => import('./pages/settings/Developer'));
const SettingsTeam = lazy(() => import('./pages/settings/Team'));
const SettingsLocalization = lazy(() => import('./pages/settings/Localization'));
const SettingsAccessibility = lazy(() => import('./pages/settings/Accessibility'));
const SettingsLabs = lazy(() => import('./pages/settings/Labs'));
const SettingsPrivacy = lazy(() => import('./pages/settings/Privacy'));
const SettingsAudit = lazy(() => import('./pages/settings/Audit'));

// Plan & Billing
const SettingsPlan = lazy(() => import('./pages/settings/Plan'));
const SettingsBilling = lazy(() => import('./pages/settings/Billing'));

// Single plan sheet (controls step via ?step=select|subscribe)
const PlanSheet = lazy(() => import('./features/billing/pages/PlanSheet'));

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
        navigate('/onboarding', { replace: true });
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
      <ProgressProvider>
        {/* No global Suspense around all Routes — avoids layout disappearing on first visit */}
        <Routes>
          {/* Dashboard shell with index route */}
          <Route
            path="/dashboard"
            element={
              <RequireVerifiedAndOnboarded>
                <DashboardLayout />
              </RequireVerifiedAndOnboarded>
            }
          >
            <Route
              index
              element={
                <Suspense fallback={null}>
                  <Dashboard />
                </Suspense>
              }
            />
          </Route>

          {/* Protected app routes under DashboardLayout (standard sidebar/topbar) */}
          <Route
            element={
              <RequireVerifiedAndOnboarded>
                <DashboardLayout />
              </RequireVerifiedAndOnboarded>
            }
          >
            <Route
              path="/orders"
              element={
                <Suspense fallback={null}>
                  <Orders />
                </Suspense>
              }
            />
            <Route
              path="/menu-items"
              element={
                <Suspense fallback={null}>
                  <MenuItemsPage />
                </Suspense>
              }
            />
            <Route
              path="/categories"
              element={
                <Suspense fallback={null}>
                  <Categories />
                </Suspense>
              }
            />
            <Route
              path="/categories/manage"
              element={
                <Suspense fallback={null}>
                  <ManageCategories />
                </Suspense>
              }
            />

            {/* Add stubs for routes so the layout persists (no blank pages) */}
            <Route path="/service-requests" element={<div className="p-6 text-sm text-slate-700">Service Requests coming soon</div>} />
            <Route path="/offers" element={<div className="p-6 text-sm text-slate-700">Offers coming soon</div>} />
            <Route path="/customers" element={<div className="p-6 text-sm text-slate-700">Customers coming soon</div>} />
            <Route path="/branches" element={<div className="p-6 text-sm text-slate-700">Branches coming soon</div>} />
            <Route path="/digital-menu" element={<div className="p-6 text-sm text-slate-700">Digital Menu coming soon</div>} />
            <Route path="/qravy-store" element={<div className="p-6 text-sm text-slate-700">Qravy Store coming soon</div>} />
          </Route>

          {/* Settings routes OUTSIDE DashboardLayout to replace the main navbar with Settings navbar */}
          <Route
            path="/settings"
            element={
              <RequireVerifiedAndOnboarded>
                <SettingsLayout />
              </RequireVerifiedAndOnboarded>
            }
          >
            <Route
              index
              element={
                <Suspense fallback={null}>
                  <SettingsOverview />
                </Suspense>
              }
            />

            {/* Plan overview */}
            <Route
              path="plan"
              element={
                <Suspense fallback={null}>
                  <SettingsPlan />
                </Suspense>
              }
            />

            {/* Single plan sheet (controls step via ?step=select|subscribe) */}
            <Route
              path="plan/select"
              element={
                <Suspense fallback={null}>
                  <PlanSheet />
                </Suspense>
              }
            />

            {/* Billing settings */}
            <Route
              path="billing"
              element={
                <Suspense fallback={null}>
                  <SettingsBilling />
                </Suspense>
              }
            />

            {/* Existing settings */}
            <Route
              path="branding"
              element={
                <Suspense fallback={null}>
                  <SettingsBranding />
                </Suspense>
              }
            />
            <Route
              path="domain"
              element={
                <Suspense fallback={null}>
                  <SettingsDomain />
                </Suspense>
              }
            />
            <Route
              path="security"
              element={
                <Suspense fallback={null}>
                  <SettingsSecurity />
                </Suspense>
              }
            />
            <Route
              path="notifications"
              element={
                <Suspense fallback={null}>
                  <SettingsNotifications />
                </Suspense>
              }
            />
            <Route
              path="integrations"
              element={
                <Suspense fallback={null}>
                  <SettingsIntegrations />
                </Suspense>
              }
            />
            <Route
              path="developer"
              element={
                <Suspense fallback={null}>
                  <SettingsDeveloper />
                </Suspense>
              }
            />
            <Route
              path="team"
              element={
                <Suspense fallback={null}>
                  <SettingsTeam />
                </Suspense>
              }
            />
            <Route
              path="localization"
              element={
                <Suspense fallback={null}>
                  <SettingsLocalization />
                </Suspense>
              }
            />
            <Route
              path="accessibility"
              element={
                <Suspense fallback={null}>
                  <SettingsAccessibility />
                </Suspense>
              }
            />
            <Route
              path="labs"
              element={
                <Suspense fallback={null}>
                  <SettingsLabs />
                </Suspense>
              }
            />
            <Route
              path="privacy"
              element={
                <Suspense fallback={null}>
                  <SettingsPrivacy />
                </Suspense>
              }
            />
            <Route
              path="audit"
              element={
                <Suspense fallback={null}>
                  <SettingsAudit />
                </Suspense>
              }
            />

            {/* Redirect uppercase paths (compat with current sidebar links) */}
            <Route path="Plan" element={<Navigate to="plan" replace />} />
            <Route path="Plan/select" element={<Navigate to="plan/select" replace />} />
            {/* Map the old nested subscribe path to query-param version */}
            <Route path="Plan/select/subscribe" element={<Navigate to="plan/select?step=subscribe" replace />} />
            <Route path="Billing" element={<Navigate to="billing" replace />} />
            <Route path="Branding" element={<Navigate to="branding" replace />} />
            <Route path="Domain" element={<Navigate to="domain" replace />} />
            <Route path="Security" element={<Navigate to="security" replace />} />
            <Route path="Notifications" element={<Navigate to="notifications" replace />} />
            <Route path="Integrations" element={<Navigate to="integrations" replace />} />
            <Route path="Developer" element={<Navigate to="developer" replace />} />
            <Route path="Team" element={<Navigate to="team" replace />} />
            <Route path="Localization" element={<Navigate to="localization" replace />} />
            <Route path="Accessibility" element={<Navigate to="accessibility" replace />} />
            <Route path="Labs" element={<Navigate to="labs" replace />} />
            <Route path="Privacy" element={<Navigate to="privacy" replace />} />
            <Route path="Audit" element={<Navigate to="audit" replace />} />
          </Route>

          {/* Redirect legacy /dashboard/* paths */}
          <Route path="/dashboard/orders" element={<Navigate to="/orders" replace />} />
          <Route path="/dashboard/menu-items" element={<Navigate to="/menu-items" replace />} />
          <Route path="/dashboard/categories" element={<Navigate to="/categories" replace />} />
          <Route path="/dashboard/categories/manage" element={<Navigate to="/categories/manage" replace />} />
          <Route path="/dashboard/settings" element={<Navigate to="/settings" replace />} />

          {/* Auth + public routes */}
          <Route
            path="/login"
            element={
              <Suspense fallback={<LoadingScreen />}>
                <Login />
              </Suspense>
            }
          />
          <Route
            path="/signup"
            element={
              <Suspense fallback={<LoadingScreen />}>
                <Signup />
              </Suspense>
            }
          />
          <Route
            path="/magic-link"
            element={
              <Suspense fallback={<LoadingScreen />}>
                <MagicLink />
              </Suspense>
            }
          />
          <Route
            path="/verify"
            element={
              <Suspense fallback={<LoadingScreen />}>
                <Verify />
              </Suspense>
            }
          />

          <Route
            path="/create-restaurant"
            element={
              <RequireAuth>
                <Suspense fallback={<LoadingScreen />}>
                  <CreateRestaurant />
                </Suspense>
              </RequireAuth>
            }
          />

          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <RequireOnboarding>
                  <Suspense fallback={<LoadingScreen />}>
                    <Onboarding />
                  </Suspense>
                </RequireOnboarding>
              </RequireAuth>
            }
          />

          {/* Home redirect */}
          <Route
            path="/"
            element={
              <Suspense fallback={<LoadingScreen />}>
                <HomeRedirect />
              </Suspense>
            }
          />
        </Routes>
        <Toaster />
      </ProgressProvider>
    </AuthProvider>
  );
}

export default App;