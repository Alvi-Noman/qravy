/**
 * @file apps/braincell/src/tests/msw/handlers/auth.ts
 * Auth-related MSW v2 handlers used across braincell tests.
 * - Uses a wildcard host pattern (star-slash) so tests work regardless of API_BASE_URL.
 * - Defaults are success-oriented; override per test with server.use(...) to simulate errors.
 */

import { http, HttpResponse, type HttpHandler } from 'msw';

/**
 * Shape of the magic-link request body.
 */
type MagicLinkBody = { email?: string };

/**
 * Exported auth handlers to be combined in handlers/index.ts
 */
export const authHandlers: HttpHandler[] = [
  /**
   * POST /api/v1/auth/refresh-token
   * Default: respond 401 so app boots as "not logged in".
   */
  http.post('*/api/v1/auth/refresh-token', () =>
    HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
  ),

  /**
   * POST /api/v1/auth/magic-link
   * Default: simple email validation then success (200).
   * Override per-test for invalid/429/network scenarios.
   */
  http.post('*/api/v1/auth/magic-link', async ({ request }) => {
    let email = '';
    try {
      const body = (await request.json()) as MagicLinkBody;
      if (typeof body.email === 'string') email = body.email;
    } catch {
      // ignore malformed JSON
    }

    if (!email || !email.includes('@')) {
      return HttpResponse.json({ message: 'Invalid email address' }, { status: 400 });
    }

    return HttpResponse.json({}, { status: 200 });
  }),

  /**
   * GET /api/v1/auth/magic-link/verify?token=...
   * Default: valid token returns a verified-but-not-onboarded user.
   * Override per-test to simulate invalid/expired tokens or custom users.
   * Tokens:
   * - "invalid" or "bad" -> 400 Invalid token
   * - "expired"          -> 410 Link expired
   */
  http.get('*/api/v1/auth/magic-link/verify', ({ request }) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token || token === 'invalid' || token === 'bad' || token === 'expired') {
      const isExpired = token === 'expired';
      return HttpResponse.json(
        { message: isExpired ? 'Link expired' : 'Invalid token' },
        { status: isExpired ? 410 : 400 }
      );
    }

    return HttpResponse.json(
      {
        token: 'verified-token',
        user: { id: '1', email: 'owner@example.com', isVerified: true, isOnboarded: false },
      },
      { status: 200 }
    );
  }),

  /**
   * GET /api/v1/auth/me
   * Default: requires Bearer token; otherwise 401.
   */
  http.get('*/api/v1/auth/me', ({ request }) => {
    const auth = request.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ')) {
      return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    return HttpResponse.json(
      { user: { id: '1', email: 'owner@example.com', isVerified: true, isOnboarded: false } },
      { status: 200 }
    );
  }),

  /**
   * POST /api/v1/auth/logout
   * Default: success (200).
   */
  http.post('*/api/v1/auth/logout', () => HttpResponse.json({}, { status: 200 })),

  /**
   * POST /api/v1/auth/onboarding/complete
   * Default: toggles isOnboarded to true.
   */
  http.post('*/api/v1/auth/onboarding/complete', () =>
    HttpResponse.json(
      { user: { id: '1', email: 'owner@example.com', isVerified: true, isOnboarded: true } },
      { status: 200 }
    )
  ),
];