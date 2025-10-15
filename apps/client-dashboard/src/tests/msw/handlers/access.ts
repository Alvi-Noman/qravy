// apps/client-dashboard/src/tests/msw/handlers/access.ts
import type { HttpHandler } from 'msw';
import { http, HttpResponse } from 'msw';

export const accessHandlers: HttpHandler[] = [
  // Device lookup (allow by default)
  http.get('*/api/v1/access/devices/lookup', () =>
    HttpResponse.json({ allowed: true }, { status: 200 })
  ),

  // Workspaces (empty list is fine for tests)
  http.get('*/api/v1/access/workspaces', () =>
    HttpResponse.json({ items: [] }, { status: 200 })
  ),

  // Confirm invite (cover a few token cases so tests don’t warn)
  http.get('*/api/v1/access/confirm-invite', ({ request }) => {
    const url = new URL(request.url);
    const token = url.searchParams.get('inviteToken');

    if (token === 'expired') return HttpResponse.json({ message: 'Link expired' }, { status: 410 });
    if (token === 'bad') return HttpResponse.json({ message: 'Invalid token' }, { status: 400 });
    if (token === 'net') return HttpResponse.error();

    return HttpResponse.json({ ok: true }, { status: 200 });
  }),
];
