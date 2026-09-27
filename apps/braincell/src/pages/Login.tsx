// apps/braincell/src/pages/Login.tsx
import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import api, { sendMagicLink, verifyOtp } from '../api/auth';
import { useAuthContext } from '../context/AuthContext';
import { AnimatePresence, motion } from 'framer-motion';
import Logo from '../components/Logo';

type Workspace = { id: string; name: string };
type DeviceLookup =
  | { found: false }
  | { found: true; tenantId: string; locationId: string | null; locationName: string | null };

type AuthUser = {
  id: string;
  email: string;
  isVerified?: boolean;
  isOnboarded?: boolean;
  tenantId?: string | null;
  capabilities?: string[];
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  sessionType?: 'member' | 'branch';
};

type VerifyResponse = {
  token: string;
  user: AuthUser;
};

export default function Login() {
  const { token, user, loading, login, reloadUser } = useAuthContext();
  const navigate = useNavigate();
  const [showEmail, setShowEmail] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [joining, setJoining] = useState<string | null>(null);
  const [verifiedUser, setVerifiedUser] = useState<AuthUser | null>(null);
  const [verifiedToken, setVerifiedToken] = useState<string>('');

  // 🚨 Redirect if already authenticated
  useEffect(() => {
    if (!loading && token && user) {
      if (!user.tenantId) {
        navigate('/create-restaurant', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [token, user, loading, navigate]);

  // 🚨 Watch for cross-tab login events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'login' && e.newValue && user) {
        if (!user.tenantId) {
          navigate('/create-restaurant', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [navigate, user]);

  const handleSuccessLogin = async (accessToken: string, usr: AuthUser) => {
    login(accessToken, usr);
    try {
      // Device lookup (auto-select tenant if the device already belongs to one)
      const lookupRes = await api.get<DeviceLookup>('/api/v1/access/devices/lookup', {
        withCredentials: true,
      });

      if (lookupRes.status === 200) {
        const lookup = lookupRes.data;
        if (lookup && 'found' in lookup && lookup.found) {
          const sel = await api.post<{ token?: string }>(
            '/api/v1/access/select-tenant',
            { tenantId: lookup.tenantId },
            { withCredentials: true }
          );
          const nextToken = sel.data?.token as string | undefined;
          if (nextToken) {
            login(nextToken, { ...usr, tenantId: lookup.tenantId, isOnboarded: true });
            await reloadUser();
            navigate('/dashboard', { replace: true });
            return;
          }
        }
      }

      // Otherwise show workspaces (for central email users), or route by tenantId
      const wsRes = await api.get<{ items?: Workspace[] }>(
        '/api/v1/access/workspaces',
        { withCredentials: true }
      );

      if (wsRes.status === 200) {
        const wsJson = wsRes.data;
        const items: Workspace[] = wsJson?.items || [];
        if (items.length > 0) {
          setWorkspaces(items);
          setVerifiedToken(accessToken);
          setVerifiedUser(usr);
          return;
        }
      }

      await reloadUser();
      navigate(usr.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
    } catch {
      await reloadUser();
      navigate(usr.tenantId ? '/dashboard' : '/create-restaurant', { replace: true });
    }
  };

  const onJoin = async (tenantId: string) => {
    try {
      if (!verifiedUser || !verifiedToken) return;
      setJoining(tenantId);

      const sel = await api.post<{ token?: string }>(
        '/api/v1/access/select-tenant',
        { tenantId },
        { withCredentials: true }
      );
      if (sel.status !== 200) throw new Error('Failed to join workspace');

      const selJson = sel.data;
      const nextToken = selJson?.token as string | undefined;
      if (!nextToken) throw new Error('No token returned');

      login(nextToken, { ...verifiedUser, tenantId, isOnboarded: true });
      await reloadUser();

      navigate('/access/select-location', { replace: true });
    } catch {
      setJoining(null);
    } finally {
      setJoining(null);
    }
  };

  // If logged in, don't render login UI at all
  if (!loading && token && user && workspaces.length === 0) {
    return null; // Just let useEffect redirect
  }

  if (workspaces.length > 0) {
    return (
      <div className="min-h-screen w-full bg-[#fcfcfc] font-inter flex items-center justify-center px-4">
        <div className="w-full max-w-lg rounded-2xl border border-[#ececec] bg-white p-6 shadow">
          <h1 className="text-center text-[18px] font-semibold text-slate-900">
            You have access to these workspaces
          </h1>

          <div className="mt-6 space-y-4">
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className="rounded-lg border border-[#e5e5e5] bg-white p-4 shadow-sm flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded bg-slate-800 text-white grid place-items-center text-[12px] font-semibold">
                    {ws.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-[14px] font-medium text-slate-900">{ws.name}</div>
                    <div className="text-[12px] text-slate-500">1 member</div>
                  </div>
                </div>
                <button
                  onClick={() => onJoin(ws.id)}
                  disabled={joining === ws.id}
                  className="rounded-md border border-[#e2e2e2] px-3 py-1.5 text-[12px] hover:bg-slate-50 disabled:opacity-60"
                >
                  {joining === ws.id ? 'Joining…' : 'Join'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#fcfcfc] flex flex-col font-inter">
      <div className="w-full max-w-md flex flex-col items-center mx-auto mt-60">
        <Logo />
        <AnimatePresence mode="wait">
          {!showEmail ? (
            <motion.div
              key="login"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center"
            >
              <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">Log in to Qravy</h2>
              <button
                className="w-96 h-12 bg-[#635bff] text-white rounded-md font-medium mb-4 transition font-inter"
                disabled
              >
                Continue with Google
              </button>
              <button
                className="w-96 h-12 bg-white border border-[#cecece] text-[#2e2e30] rounded-md font-medium mb-4 transition hover:bg-[#f5f5f5] font-inter"
                onClick={() => setShowEmail(true)}
              >
                Continue with email
              </button>
              <button
                className="w-96 h-12 bg-white border border-[#cecece] text-[#2e2e30] rounded-md font-medium mb-4 transition hover:bg-[#f5f5f5] font-inter"
                disabled
              >
                Continue with Facebook
              </button>
              <p className="text-sm text-[#5b5b5d] mt-4 font-normal font-inter">
                Don&apos;t have an account?{' '}
                <Link to="/signup" className="text-[#2e2f30] hover:underline">Sign up</Link> or{' '}
                <a href="#" className="text-[#2e2f30] hover:underline">Learn more</a>
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="email"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="w-full flex flex-col items-center"
            >
              <EmailEntry
                onBack={() => setShowEmail(false)}
                onSuccessLogin={handleSuccessLogin}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function EmailEntry({
  onBack,
  onSuccessLogin,
}: {
  onBack: () => void;
  onSuccessLogin: (token: string, user: AuthUser) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // OTP passcode state
  const [code, setCode] = useState<string[]>(['', '', '', '', '']);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const mutation = useMutation<void, Error, string>({
    mutationFn: (email: string) => sendMagicLink(email),
    onSuccess: () => {
      setSent(true);
      setVerifyError(null);
      setCode(['', '', '', '', '']);
      setTimeout(() => {
        inputsRef.current[0]?.focus();
      }, 50);
    },
  });

  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const getErrorMessage = (): string => {
    if (localError) return localError;
    if (!mutation.error) return '';

    const msg = mutation.error.message || 'Something went wrong. Please try again.';
    if (msg.includes('Invalid email address') || msg.includes('Validation failed')) {
      return 'Please enter a valid email address.';
    }
    if (msg.includes('429')) return 'Too many requests. Please wait and try again.';
    if (msg.includes('Network Error')) return 'Network error. Please check your connection.';
    return 'Something went wrong. Please try again.';
  };

  const handleSend = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLocalError(null);

    if (!email.trim()) {
      setLocalError('Please enter your email address.');
      return;
    }
    if (!isValidEmail(email)) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    mutation.mutate(email);
  };

  const handleOtpChange = (index: number, value: string) => {
    const cleaned = value.replace(/[^0-9]/g, '');
    if (!cleaned) {
      const newCode = [...code];
      newCode[index] = '';
      setCode(newCode);
      return;
    }

    const digit = cleaned[cleaned.length - 1];
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setVerifyError(null);

    // Focus next input
    if (index < 4 && digit) {
      inputsRef.current[index + 1]?.focus();
    }

    // Auto-verify if 5 digits are complete
    if (index === 4 && digit) {
      const fullCode = [...code.slice(0, 4), digit].join('');
      if (fullCode.length === 5) {
        setTimeout(() => handleOtpSubmit(fullCode), 0);
      }
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!code[index] && index > 0) {
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
        inputsRef.current[index - 1]?.focus();
      } else {
        const newCode = [...code];
        newCode[index] = '';
        setCode(newCode);
      }
      setVerifyError(null);
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 4) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').trim();
    if (/^\d{5}$/.test(pastedData)) {
      const digits = pastedData.split('');
      setCode(digits);
      setVerifyError(null);
      inputsRef.current[4]?.focus();
      handleOtpSubmit(digits.join(''));
    }
  };

  const handleOtpSubmit = async (finalCode?: string) => {
    const fullCode = finalCode || code.join('');
    if (fullCode.length !== 5) {
      setVerifyError('Please enter a 5-digit passcode.');
      return;
    }
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await verifyOtp<VerifyResponse>(email, fullCode);
      if (res && res.token && res.user) {
        await onSuccessLogin(res.token, res.user);
      } else {
        setVerifyError('Verification failed. Invalid response structure.');
      }
    } catch (err: any) {
      setVerifyError(err.message || 'Invalid or expired passcode.');
    } finally {
      setVerifying(false);
    }
  };

  if (sent) {
    return (
      <div className="w-full flex flex-col items-center font-inter">
        <h2 className="text-xl font-medium mb-3 text-[#2e2e30]">Enter the 5-digit passcode</h2>
        <p className="mb-6 text-[#5b5b5d] text-base font-normal text-center max-w-sm leading-relaxed">
          We&apos;ve sent a passcode and a login link to<br />
          <span className="font-semibold text-[#2e2e30] break-all">{email}</span>
        </p>

        {/* OTP Input Boxes */}
        <div className="flex gap-3 justify-center mb-5">
          {code.map((digit, idx) => (
            <input
              key={idx}
              ref={(el) => (inputsRef.current[idx] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleOtpChange(idx, e.target.value)}
              onKeyDown={(e) => handleOtpKeyDown(idx, e)}
              onPaste={handleOtpPaste}
              disabled={verifying}
              className="w-12 h-14 border border-[#cecece] rounded-lg text-center text-xl font-semibold text-[#2e2e30] bg-transparent focus:border-[#635bff] focus:ring-1 focus:ring-[#635bff] focus:outline-none transition-all disabled:opacity-50"
            />
          ))}
        </div>

        {verifyError && (
          <div className="text-red-500 mb-4 text-sm w-96 font-normal text-center" aria-live="polite">
            {verifyError}
          </div>
        )}

        <button
          onClick={() => handleOtpSubmit()}
          className={`w-96 h-12 rounded-md font-medium mb-4 transition border text-center flex items-center justify-center gap-2
            ${verifying
              ? 'bg-[#fefefe] border-[#cecece] text-[#b0b0b5] cursor-not-allowed'
              : 'bg-[#635bff] border-[#635bff] text-white hover:bg-[#514bd4]'
            }
          `}
          disabled={verifying}
        >
          {verifying ? (
            <>
              <svg className="animate-spin h-5 w-5 text-[#b0b0b5]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Verifying...</span>
            </>
          ) : (
            'Verify passcode'
          )}
        </button>

        <p className="text-sm text-[#5b5b5d] text-center max-w-sm mt-2 leading-relaxed">
          Or, click the login link inside the email to log in directly.
        </p>

        <button
          className="text-sm text-[#5b5b5d] underline mt-6 font-normal"
          onClick={onBack}
          disabled={verifying}
        >
          Back to login
        </button>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center font-inter">
      <h2 className="text-xl font-medium mb-6 text-[#2e2e30]">What&apos;s your email address?</h2>
      <form onSubmit={handleSend} noValidate className="w-full flex flex-col items-center">
        <input
          type="email"
          placeholder="Enter your email address..."
          className="p-3 w-96 border border-[#cecece] hover:border-[#b0b0b5] rounded-md mb-4 text-[#2e2e30] bg-transparent focus:outline-none text-base font-normal"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEmail(e.target.value);
            setLocalError(null);
          }}
          required
          disabled={mutation.isPending}
        />
        {(localError || mutation.isError) && (
          <div className="text-red-500 -mt-3 mb-4 text-sm w-96 font-normal text-left" aria-live="polite">
            {getErrorMessage()}
          </div>
        )}
        <button
          type="submit"
          className={`w-96 h-12 rounded-md font-medium mb-4 transition border text-center
            ${mutation.isPending
              ? 'bg-[#fefefe] border-[#cecece] text-[#b0b0b5] cursor-not-allowed'
              : 'bg-white border-[#cecece] text-[#2e2e30] hover:bg-[#f5f5f5]'
            }
          `}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Sending...' : 'Continue with email'}
        </button>
      </form>
      <button
        className="mt-2 text-sm text-[#2e2e30] hover:underline font-normal"
        onClick={onBack}
        disabled={mutation.isPending}
      >
        Back to login
      </button>
    </div>
  );
}
