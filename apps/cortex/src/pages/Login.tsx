// apps/cortex/src/pages/Login.tsx — sign in with the company admin's email or username.
import { useState } from 'react';
import { signIn } from '../api';

export default function Login({ onSignedIn }: { onSignedIn: (email: string) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const admin = await signIn(login.trim(), password);
      onSignedIn(admin.email);
    } catch (err) {
      setError((err as Error).message || 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/cortex.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="text-[18px] font-semibold text-stone-900">Cortex</h1>
            <p className="text-[12px] text-stone-500">Qravy platform admin</p>
          </div>
        </div>
        <label htmlFor="login" className="text-[13px] font-medium text-stone-700">
          Email or username
        </label>
        <input
          id="login"
          autoFocus
          autoComplete="username"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          className="mt-1 mb-4 w-full rounded-lg border border-stone-300 px-3 py-2 text-[14px] outline-none focus:border-stone-500"
        />
        <label htmlFor="password" className="text-[13px] font-medium text-stone-700">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-[14px] outline-none focus:border-stone-500"
        />
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !login || !password}
          className="mt-5 w-full rounded-lg bg-stone-900 py-2.5 text-[14px] font-medium text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
