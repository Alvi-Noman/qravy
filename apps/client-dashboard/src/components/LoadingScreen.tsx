import React, { useEffect, useState } from 'react';

export default function LoadingScreen() {
  const [visible, setVisible] = useState(false);

  // Fade-in effect
  useEffect(() => {
    const timeout = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-500 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'linear-gradient(135deg, #f5f5f5 0%, #fcfcfc 100%)' }}
    >
      <img
        src="/logo.svg"
        alt="Logo"
        className="mb-8"
        style={{ width: 56, height: 56, filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.04))' }}
      />
      <div className="mt-2 text-gray-700 text-lg font-semibold tracking-wide">
        Loading...
      </div>
    </div>
  );
}