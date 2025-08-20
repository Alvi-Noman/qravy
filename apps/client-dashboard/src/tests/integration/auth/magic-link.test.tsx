import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '../../msw/server';

import MagicLink from '../../../pages/magic-link';
import { AuthProvider } from '../../../context/AuthContext';

function renderPage(initialPath = '/magic-link?token=ok') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  window.localStorage.clear();

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/magic-link"
            element={
              <AuthProvider>
                <MagicLink />
              </AuthProvider>
            }
          />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
          <Route path="/create-restaurant" element={<div>Create Restaurant</div>} />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Magic link verification page', () => {
  it(
    'logs in and redirects to /dashboard when user is onboarded',
    async () => {
      server.use(
        http.get('*/api/v1/auth/magic-link/verify', () =>
          HttpResponse.json(
            {
              token: 'abc123',
              user: {
                id: 'u1',
                email: 'owner@example.com',
                name: 'Owner',
                company: 'Demo Co',
                isOnboarded: true,
              },
            },
            { status: 200 }
          )
        )
      );

      renderPage('/magic-link?token=onboarded');

      // Wait for the 1.5s redirect to happen
      expect(
        await screen.findByText(/dashboard/i, undefined, { timeout: 2500 })
      ).toBeInTheDocument();
    },
    { timeout: 8000 }
  );

  it(
    'logs in and redirects to /create-restaurant when user is not onboarded',
    async () => {
      server.use(
        http.get('*/api/v1/auth/magic-link/verify', () =>
          HttpResponse.json(
            {
              token: 'abc123',
              user: {
                id: 'u2',
                email: 'new@example.com',
                name: 'New User',
                company: 'New Co',
                isOnboarded: false,
              },
            },
            { status: 200 }
          )
        )
      );

      renderPage('/magic-link?token=new-user');

      expect(
        await screen.findByText(/create restaurant/i, undefined, { timeout: 2500 })
      ).toBeInTheDocument();
    },
    { timeout: 8000 }
  );

  it(
    'shows error screen (Session Expired) on invalid token',
    async () => {
      server.use(
        http.get('*/api/v1/auth/magic-link/verify', () =>
          HttpResponse.json({ message: 'Invalid token' }, { status: 400 })
        )
      );

      renderPage('/magic-link?token=bad');

      expect(
        await screen.findByRole('heading', { name: /session expired/i }, { timeout: 2000 })
      ).toBeInTheDocument();

      const user = userEvent.setup();
      const loginAgain = screen.getByRole('link', { name: /log in again/i });
      expect(loginAgain).toHaveAttribute('href', '/login');
      await user.click(loginAgain);
      expect(await screen.findByText(/login page/i)).toBeInTheDocument();
    },
    { timeout: 8000 }
  );

  it(
    'shows error screen (Session Expired) when link is expired (e.g., 410)',
    async () => {
      server.use(
        http.get('*/api/v1/auth/magic-link/verify', () =>
          HttpResponse.json({ message: 'Link expired' }, { status: 410 })
        )
      );

      renderPage('/magic-link?token=expired');

      expect(
        await screen.findByRole('heading', { name: /session expired/i }, { timeout: 2000 })
      ).toBeInTheDocument();
    },
    { timeout: 8000 }
  );

  it(
    'shows error screen on network error',
    async () => {
      server.use(http.get('*/api/v1/auth/magic-link/verify', () => HttpResponse.error()));

      renderPage('/magic-link?token=net');

      expect(
        await screen.findByRole('heading', { name: /session expired/i }, { timeout: 2000 })
      ).toBeInTheDocument();
    },
    { timeout: 8000 }
  );

  it('renders nothing (no success or error screen) when token is missing', () => {
    renderPage('/magic-link');
    expect(screen.queryByRole('heading', { name: /session expired/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/dashboard/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/create restaurant/i)).not.toBeInTheDocument();
  });
});