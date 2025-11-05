// apps/tastebud/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CartProvider } from './context/CartContext';
import { TTSProvider } from './state/TTSProvider'; // ✅ added
import './index.css';
import App from './App';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <CartProvider>
          {/* ✅ TTSProvider mounted once globally */}
          <TTSProvider>
            <App />
          </TTSProvider>
        </CartProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
