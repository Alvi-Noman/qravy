// apps/cortex/src/App.tsx — sign-in gate + routes.
import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, getToken } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Live from './pages/Live';
import Restaurants from './pages/Restaurants';
import RestaurantDetail from './pages/RestaurantDetail';
import Sessions from './pages/Sessions';
import SessionDetail from './pages/SessionDetail';
import Conversations from './pages/Conversations';
import Orders from './pages/Orders';
import Pronunciation from './pages/Pronunciation';
import LiveTranscripts from './pages/LiveTranscripts';
import SpeechToText from './pages/SpeechToText';

export default function App() {
  const qc = useQueryClient();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(!!getToken());

  // a saved token: still good?
  useEffect(() => {
    if (!getToken()) return;
    api<{ admin: { email: string } }>('/me')
      .then((r) => setEmail(r.admin.email))
      .catch(() => setEmail(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const out = () => {
      setEmail(null);
      qc.clear();
    };
    window.addEventListener('cortex:signed-out', out);
    return () => window.removeEventListener('cortex:signed-out', out);
  }, [qc]);

  if (checking) return <div className="p-10 text-center text-sm text-stone-500">Loading…</div>;
  if (!email) return <Login onSignedIn={setEmail} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <Layout
              email={email}
              onSignOut={() => {
                setEmail(null);
                qc.clear();
              }}
            />
          }
        >
          <Route index element={<Overview />} />
          <Route path="live" element={<Live />} />
          <Route path="restaurants" element={<Restaurants />} />
          <Route path="restaurants/:id" element={<RestaurantDetail />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:vid" element={<SessionDetail />} />
          <Route path="transcripts" element={<LiveTranscripts />} />
          <Route path="conversations" element={<Conversations />} />
          <Route path="orders" element={<Orders />} />
          <Route path="pronunciation" element={<Pronunciation />} />
          <Route path="speech-to-text" element={<SpeechToText />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
