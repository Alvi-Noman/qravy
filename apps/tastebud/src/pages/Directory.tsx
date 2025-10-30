import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

type Channel = 'dine-in' | 'online';

const getRuntime = () =>
  (typeof window !== 'undefined' && window.__STORE__) || {
    subdomain: null as string | null,
    channel: null as Channel | null,
    branch: null as string | null,
    apiBase: '/api/v1',
  };

export default function Home() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const runtime = useMemo(getRuntime, []);
  const [subdomainInput, setSubdomainInput] = useState(runtime.subdomain ?? '');

  const hasTenant = Boolean(runtime.subdomain);
  const hasBranch = Boolean(runtime.branch);

  const defaultChannel: Channel = (runtime.channel === 'dine-in' ? 'dine-in' : 'online');

  const goToTenant = (ch: Channel = defaultChannel) => {
    if (!subdomainInput.trim()) return;
    const base = `/t/${encodeURIComponent(subdomainInput.trim())}`;
    navigate(ch === 'dine-in' ? `${base}/dine-in` : base);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-black" />
            <span className="font-semibold">Tastebud</span>
          </div>
          <nav className="text-sm">
            <Link to="/" className="hover:underline">
              Home
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to Tastebud</h1>
          <p className="mt-2 text-gray-600">
            This is the storefront client. Point it at a tenant subdomain to browse their menu.
          </p>
        </div>

        {/* Quick actions if host injected a tenant/channel/branch */}
        <section className="mb-10">
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Detected runtime</h2>
            <p className="mt-1 text-sm text-gray-600">
              These values come from <code>window.__STORE__</code> if you&apos;re running behind the
              storefront-host.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Subdomain</div>
                <div className="mt-1 font-medium">{runtime.subdomain ?? <em className="text-gray-500">—</em>}</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Channel</div>
                <div className="mt-1 font-medium">{runtime.channel ?? <em className="text-gray-500">—</em>}</div>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-xs text-gray-500">Branch</div>
                <div className="mt-1 font-medium">{runtime.branch ?? <em className="text-gray-500">—</em>}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {hasTenant ? (
                <>
                  <Link
                    to={`/t/${encodeURIComponent(runtime.subdomain!)}`}
                    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    Go to <strong>{runtime.subdomain}</strong> (online)
                  </Link>
                  <Link
                    to={`/t/${encodeURIComponent(runtime.subdomain!)}/dine-in`}
                    className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    Go to <strong>{runtime.subdomain}</strong> (dine-in)
                  </Link>
                  {hasBranch && (
                    <>
                      <Link
                        to={`/t/${encodeURIComponent(runtime.subdomain!)}/branch/${encodeURIComponent(
                          runtime.branch!
                        )}`}
                        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        Branch <strong>{runtime.branch}</strong> (online)
                      </Link>
                      <Link
                        to={`/t/${encodeURIComponent(runtime.subdomain!)}/branch/${encodeURIComponent(
                          runtime.branch!
                        )}/dine-in`}
                        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                      >
                        Branch <strong>{runtime.branch}</strong> (dine-in)
                      </Link>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600">
                  No runtime tenant detected. You can still test by entering a subdomain below.
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Manual tester */}
        <section>
          <div className="rounded-2xl border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Try a tenant</h2>
            <p className="mt-1 text-sm text-gray-600">
              Enter a subdomain to navigate to tenant routes (e.g. <code>demo</code>).
            </p>

            <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row">
              <input
                value={subdomainInput}
                onChange={(e) => setSubdomainInput(e.target.value)}
                placeholder="subdomain (e.g. demo)"
                className="w-full max-w-xs rounded-xl border px-3 py-2 text-sm outline-none focus:ring"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => goToTenant('online')}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Open Online
                </button>
                <button
                  onClick={() => goToTenant('dine-in')}
                  className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Open Dine-in
                </button>
              </div>
            </div>

            {/* Show where we are for clarity */}
            <div className="mt-6 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
              <div>
                <span className="font-medium">Current path:</span> <code>{pathname}</code>
              </div>
              <div className="mt-1">
                <span className="font-medium">API Base:</span> <code>{runtime.apiBase}</code>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-4 py-10 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} Tastebud.
      </footer>
    </div>
  );
}
