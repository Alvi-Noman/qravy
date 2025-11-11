// apps/tastebud/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TTSProvider } from './state/TTSProvider';
import AppRouter from './router'; // 👈 use router.tsx directly
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <AppRouter />
      </TTSProvider>
    </QueryClientProvider>
  </StrictMode>
);
