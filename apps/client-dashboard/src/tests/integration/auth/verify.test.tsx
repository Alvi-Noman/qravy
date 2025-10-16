import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../msw/server';

import Verify from '../../../pages/verify';

function renderVerify(initialPath = '/verify?token=ok') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const ui = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/verify" element={<Verify />} />
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/signup" element={<div>Signup Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { user: userEvent.setup(), ...ui };
}

describe('Verify Email', () => {
  it('shows "Verifying..." while pending, then success UI and link to Login', async () => {
    server.use(
      http.get('*/api/v1/auth/verify-email', async () => {
        await delay(300);
        return HttpResponse.json({}, { status: 200 });
      })
    );

    const { user } = renderVerify('/verify?token=success-token');

    // Pending state
    expect(await screen.findByText(/verifying\.\.\./i)).toBeInTheDocument();

    // Success state
    expect(
      await screen.findByText(/your email has been verified! you can now log in\./i)
    ).toBeInTheDocument();

    const goToLogin = screen.getByRole('link', { name: /go to login/i });
    expect(goToLogin).toHaveAttribute('href', '/login');

    await user.click(goToLogin);
    expect(await screen.findByText(/login page/i)).toBeInTheDocument();
  });

  it('shows friendly error when server returns "Verification failed"', async () => {
    server.use(
      http.get('*/api/v1/auth/verify-email', () =>
        HttpResponse.json({ message: 'Verification failed' }, { status: 400 })
      )
    );

    const { user } = renderVerify('/verify?token=bad');

    expect(
      await screen.findByText(
        /verification failed\. please check your link or request a new verification email\./i
      )
    ).toBeInTheDocument();

    const signupLink = screen.getByRole('link', { name: /sign up again/i });
    expect(signupLink).toHaveAttribute('href', '/signup');

    await user.click(signupLink);
    expect(await screen.findByText(/signup page/i)).toBeInTheDocument();
  });

  it('shows rate limit message when server responds with 429', async () => {
    server.use(
      http.get('*/api/v1/auth/verify-email', () =>
        HttpResponse.json({ message: '429 Too many requests' }, { status: 429 })
      )
    );

    renderVerify('/verify?token=too-many');

    expect(
      await screen.findByText(/too many requests\. please wait and try again\./i)
    ).toBeInTheDocument();
  });

  it('shows network error when request fails to connect', async () => {
    server.use(
      http.get('*/api/v1/auth/verify-email', () => HttpResponse.error())
    );

    renderVerify('/verify?token=net');

    expect(
      await screen.findByText(/network error\. please check your connection\./i)
    ).toBeInTheDocument();
  });
});