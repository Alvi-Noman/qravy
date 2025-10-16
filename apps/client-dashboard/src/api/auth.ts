/**
 * API client and auth endpoints.
 * - Authorization header via request interceptor
 * - Single-flight refresh using a plain client (no interceptor recursion)
 * - Retries the original request after a successful refresh
 */
import axios, {
  AxiosHeaders,
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  // safe fallback to your public gateway (change to https://api.qravy.com when you move)
  'https://muvance-api-gateway.onrender.com';

const REFRESH_URL = '/api/v1/auth/refresh-token';

/** Primary axios instance (uses interceptors) */
const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

/** Plain axios instance (no interceptors) — used for refresh */
const plain: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

let refreshInFlight: Promise<void> | null = null;

/** Utility: set/update Authorization header on a request config */
function applyAuthHeader(
  cfg: InternalAxiosRequestConfig & { _retry?: boolean },
  token: string | null
) {
  if (!token) return;
  if (cfg.headers instanceof AxiosHeaders) {
    cfg.headers.set('Authorization', `Bearer ${token}`);
  } else {
    cfg.headers = AxiosHeaders.from(cfg.headers || {});
    (cfg.headers as AxiosHeaders).set('Authorization', `Bearer ${token}`);
  }
}

/**
 * Attach auth interceptors to axios instance.
 */
export function attachAuthInterceptor(
  getToken: () => string | null,
  refreshAccessToken: () => Promise<void>,
  logout: () => void
): void {
  // Attach Authorization on outgoing requests
  api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getToken();
    applyAuthHeader(config, token);
    return config;
  });

  // Handle 401, refresh once, then retry original request
  api.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
      if (!original) return Promise.reject(error);

      const status = error.response?.status;
      const isRefreshCall = Boolean(original.url && original.url.includes(REFRESH_URL));

      if (status === 401 && !original._retry && !isRefreshCall) {
        original._retry = true;

        try {
          if (!refreshInFlight) {
            refreshInFlight = refreshAccessToken();
          }
          await refreshInFlight;
        } catch {
          // refresh failed → clear flag, log out, surface error
          refreshInFlight = null;
          logout();
          return Promise.reject(error);
        }
        // refresh succeeded → clear flag, re-issue with new token
        refreshInFlight = null;

        const token = getToken();
        applyAuthHeader(original, token);
        return api.request(original);
      }

      return Promise.reject(error);
    }
  );
}

/**
 * Extract a user-friendly error message.
 */
function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string } | undefined;
    return data?.message || error.message || 'Request failed';
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
}

/**
 * Send a magic login link to the user's email.
 */
export async function sendMagicLink(email: string): Promise<void> {
  try {
    await api.post('/api/v1/auth/magic-link', { email });
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Verify magic link and receive access token + user object.
 * Provide a generic to type the response shape at call sites.
 */
export async function verifyMagicLink<T = unknown>(token: string): Promise<T> {
  try {
    const response = await api.get<T>(
      `/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`
    );
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Get current user (optionally with an explicit token).
 * Provide a generic to type the response shape at call sites.
 */
export async function getMe<T = unknown>(token?: string): Promise<T> {
  try {
    const headers = token ? AxiosHeaders.from({ Authorization: `Bearer ${token}` }) : undefined;
    const response = await api.get<T>('/api/v1/auth/me', { headers });
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Rotate refresh token and receive a new access token.
 * Uses a plain client to avoid interceptor recursion.
 * Provide a generic to type the response shape at call sites.
 */
export async function refreshToken<T = unknown>(): Promise<T> {
  try {
    // POST with no body/headers keeps preflight minimal
    const response = await plain.post<T>(REFRESH_URL);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Mark onboarding as complete for the current user.
 * Provide a generic to type the response shape at call sites.
 */
export async function completeOnboarding<T = unknown>(token?: string): Promise<T> {
  try {
    const headers = token ? AxiosHeaders.from({ Authorization: `Bearer ${token}` }) : undefined;
    const response = await api.post<T>('/api/v1/auth/onboarding/complete', null, { headers });
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Create a tenant (restaurant) with name and subdomain.
 * Uses Authorization from interceptor; token param not required.
 * Provide a generic to type the response shape at call sites.
 */
export async function createTenant<T = unknown>(body: { name: string; subdomain: string }): Promise<T> {
  try {
    const response = await api.post<T>('/api/v1/auth/tenants', body);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Get the current user's tenant.
 * Provide a generic to type the response shape at call sites.
 */
export async function getMyTenant<T = unknown>(): Promise<T> {
  try {
    const response = await api.get<T>('/api/v1/auth/tenants/me');
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export default api;
