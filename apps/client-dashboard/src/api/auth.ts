/**
 * API client and auth endpoints.
 * - Adds Authorization on requests
 * - Single-flight refresh with a plain client (no interceptor recursion)
 * - Retries the original request after refresh
 */
import axios, {
  AxiosHeaders,
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8080';
const REFRESH_URL = '/api/v1/auth/refresh-token';

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

const plain: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true
});

let refreshInFlight: Promise<void> | null = null;

/**
 * Attach auth interceptors to axios instance.
 * @param {() => string | null} getToken
 * @param {() => Promise<void>} refreshAccessToken
 * @param {() => void} logout
 * @returns {void}
 */
export function attachAuthInterceptor(
  getToken: () => string | null,
  refreshAccessToken: () => Promise<void>,
  logout: () => void
): void {
  api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getToken();
    if (token) {
      if (config.headers instanceof AxiosHeaders) {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers = AxiosHeaders.from(config.headers || {});
        (config.headers as AxiosHeaders).set('Authorization', `Bearer ${token}`);
      }
    }
    return config;
  });

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
          if (!refreshInFlight) refreshInFlight = refreshAccessToken();
          await refreshInFlight;
        } catch {
          refreshInFlight = null;
          logout();
          return Promise.reject(error);
        }
        refreshInFlight = null;

        const token = getToken();
        if (token) {
          if (original.headers instanceof AxiosHeaders) {
            original.headers.set('Authorization', `Bearer ${token}`);
          } else {
            original.headers = AxiosHeaders.from(original.headers || {});
            (original.headers as AxiosHeaders).set('Authorization', `Bearer ${token}`);
          }
        }

        return api.request(original);
      }

      return Promise.reject(error);
    }
  );
}

/**
 * Extract a user-friendly error message.
 * @param {unknown} error
 * @returns {string}
 */
function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const msg = (error.response?.data as any)?.message || error.message || 'Request failed';
    return msg;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
}

/**
 * Send a magic login link to the user's email.
 * @param {string} email
 * @returns {Promise<void>}
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
 * @param {string} token
 * @returns {Promise<any>}
 */
export async function verifyMagicLink(token: string): Promise<any> {
  try {
    const response = await api.get(`/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Get current user.
 * @param {string=} token
 * @returns {Promise<any>}
 */
export async function getMe(token?: string): Promise<any> {
  try {
    const headers = token ? AxiosHeaders.from({ Authorization: `Bearer ${token}` }) : undefined;
    const response = await api.get('/api/v1/auth/me', { headers });
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Rotate refresh token and receive a new access token.
 * Uses a plain client to avoid interceptor recursion.
 * @returns {Promise<any>}
 */
export async function refreshToken(): Promise<any> {
  try {
    const response = await plain.post(REFRESH_URL, null, {
      headers: { 'Content-Type': undefined } // Avoid preflight
    });
    return response.data;
  } catch (error) {
    console.error('Refresh token error:', error);
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Mark onboarding as complete for the current user.
 * @param {string=} token
 * @returns {Promise<any>}
 */
export async function completeOnboarding(token?: string): Promise<any> {
  try {
    const headers = token ? AxiosHeaders.from({ Authorization: `Bearer ${token}` }) : undefined;
    const response = await api.post('/api/v1/auth/onboarding/complete', null, { headers });
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export default api;