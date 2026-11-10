// apps/rider/src/App.tsx — Qravy Rider. /r/<link>: that restaurant's deliveries (the link the restaurant sent; it is
// remembered on the phone). /: the app opened on its own — the last restaurant, a list to pick from, or "connect"
// (scan the QR code the restaurant shows, or paste the link).
import { Navigate, Route, Routes } from 'react-router-dom';
import Deliveries from './pages/Deliveries';
import Connect from './pages/Connect';
import InstallGuide from './pages/InstallGuide';
import { savedLinks } from './links';

function Start() {
  const links = savedLinks();
  if (links.length === 1) return <Navigate replace to={`/r/${links[0].token}`} />;
  return <Connect />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Start />} />
      <Route path="/connect" element={<Connect />} />
      {/* opened in a browser: first the way to put it on the home screen (it then opens right here, signed in) */}
      <Route path="/r/:token" element={<InstallGuide><Deliveries /></InstallGuide>} />
      {/* (the first links pointed at the guest site's /rider/<link>) */}
      <Route path="/rider/:token" element={<InstallGuide><Deliveries /></InstallGuide>} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
