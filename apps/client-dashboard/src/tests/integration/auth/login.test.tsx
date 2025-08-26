import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../tests/msw/server';
import { describe, it, expect } from 'vitest';

import Login from '../../../pages/Login';
import { AuthProvider } from '../../../context/AuthContext';

function renderLogin(initialRoute = '/login') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const ui = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <Routes>
          <Route
            path="/login"
            element={
              <AuthProvider>
                <Login />
              </AuthProvider>
            }
          />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { user: userEvent.setup(), ...ui };
}

async function goToEmailEntry(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /continue with email/i }));
  await screen.findByRole('heading', { name: /what's your email address\?/i });
}

describe('Login (magic link)', () => {
  it('renders initial login choices and toggles to email entry', async () => {
    const { user } = renderLogin();

    expect(screen.getByRole('heading', { name: /log in to qravy/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /continue with facebook/i })).toBeDisabled();

    await goToEmailEntry(user);

    expect(screen.getByPlaceholderText(/enter your email address\.\.\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to login/i })).toBeInTheDocument();
  });

  it('validates required and invalid email', async () => {
    const { user } = renderLogin();
    await goToEmailEntry(user);

    const submit = screen.getByRole('button', { name: /^continue with email$/i });

    await user.click(submit);
    expect(await screen.findByText(/please enter your email address\./i)).toBeVisible();

    const input = screen.getByPlaceholderText(/enter your email address\.\.\./i);
    await user.clear(input);
    await user.type(input, 'not-an-email');
    await user.click(submit);

    expect(await screen.findByText(/please enter a valid email address\./i)).toBeVisible();
  });

  it('shows loading state "Sending..." while requesting', async () => {
    server.use(
      http.post('*/api/v1/auth/magic-link', async () => {
        await delay(400);
        return HttpResponse.json({}, { status: 200 });
      })
    );

    const { user } = renderLogin();
    await goToEmailEntry(user);

    const input = screen.getByPlaceholderText(/enter your email address\.\.\./i);
    await user.type(input, 'demo@example.com');

    const submit = screen.getByRole('button', { name: /^continue with email$/i });
    await user.click(submit);

    expect(await screen.findByRole('button', { name: /sending\.\.\./i })).toBeDisabled();
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument();
  });

  it('submits successfully and shows success UI with the entered email', async () => {
    const { user } = renderLogin();
    await goToEmailEntry(user);

    const input = screen.getByPlaceholderText(/enter your email address\.\.\./i);
    await user.type(input, 'test@example.com');

    const submit = screen.getByRole('button', { name: /^continue with email$/i });
    await user.click(submit);

    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to login/i }));
    expect(await screen.findByRole('heading', { name: /log in to qravy/i })).toBeInTheDocument();
  });

  it('maps server validation error to a friendly message', async () => {
    server.use(
      http.post('*/api/v1/auth/magic-link', () =>
        HttpResponse.json({ message: 'Invalid email address' }, { status: 400 })
      )
    );

    const { user } = renderLogin();
    await goToEmailEntry(user);

    const input = screen.getByPlaceholderText(/enter your email address\.\.\./i);
    await user.type(input, 'invalid@example');

    const submit = screen.getByRole('button', { name: /^continue with email$/i });
    await user.click(submit);

    expect(await screen.findByText(/please enter a valid email address\./i)).toBeVisible();
  });

  it('shows rate limit error when server responds with 429', async () => {
    server.use(
      http.post('*/api/v1/auth/magic-link', () =>
        HttpResponse.json({ message: '429 Too many requests' }, { status: 429 })
      )
    );

    const { user } = renderLogin();
    await goToEmailEntry(user);

    const input = screen.getByPlaceholderText(/enter your email address\.\.\./i);
    await user.type(input, 'rate@example.com');

    const submit = screen.getByRole('button', { name: /^continue with email$/i });
    await user.click(submit);

    expect(await screen.findByText(/too many requests\. please wait and try again\./i)).toBeVisible();
  });

  it('shows network error when request fails to connect', async () => {
    server.use(http.post('*/api/v1/auth/magic-link', () => HttpResponse.error()));

    const { user } = renderLogin();
    await goToEmailEntry(user);

    const input = screen.getByPlaceholderText(/enter your email address\.\.\./i);
    await user.type(input, 'net@example.com');

    const submit = screen.getByRole('button', { name: /^continue with email$/i });
    await user.click(submit);

    expect(await screen.findByText(/network error\. please check your connection\./i)).toBeVisible();
  });

  it('redirects to /dashboard if token exists after refresh', async () => {
    server.use(
      http.post('*/api/v1/auth/refresh-token', () =>
        HttpResponse.json(
          { token: 'refreshed-token', user: { id: '1', email: 'owner@example.com' } },
          { status: 200 }
        )
      )
    );

    renderLogin();
    await waitFor(() => {
      expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
    });
  });

  it('navigates to /dashboard when storage "login" event fires', async () => {
    renderLogin();

    await screen.findByRole('heading', { name: /log in to qravy/i });

    const event = new StorageEvent('storage', {
      key: 'login',
      newValue: Date.now().toString(),
    });
    window.dispatchEvent(event);

    await waitFor(() => {
      expect(screen.getByText(/dashboard/i)).toBeInTheDocument();
    });
  });
});