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
    const response = await api.get<T>(`/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
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
    // No extra headers/body to avoid preflight
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

export default api;