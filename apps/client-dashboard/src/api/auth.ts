/**
 * API client and auth endpoints.
 * - Attaches JWT to requests
 * - Handles 401 with refresh flow
 * - Exposes auth endpoints for magic link, me, refresh, onboarding
 */
import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

/**
 * Attach auth interceptors to axios instance.
 * - Adds Authorization header when token exists
 * - On 401, attempts token refresh once, else logs out
 */
export const attachAuthInterceptor = (
  getToken: () => string | null,
  refreshToken: () => Promise<void>,
  logout: () => void
) => {
  api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  api.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;
        try {
          await refreshToken();
          const token = getToken();
          if (token && originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return api(originalRequest);
        } catch {
          logout();
        }
      }
      return Promise.reject(error);
    }
  );
};

/** Extract a user-friendly error message from an unknown error */
function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const msg =
      (error.response?.data as any)?.message ||
      error.message ||
      'Request failed';
    return msg;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
}

/** Send a magic login link to the user's email */
export async function sendMagicLink(email: string) {
  try {
    await api.post('/api/v1/auth/magic-link', { email });
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/** Verify magic link and receive access token + user object */
export async function verifyMagicLink(token: string) {
  try {
    const response = await api.get(`/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/** Get current user using a provided access token (or interceptor) */
export async function getMe(token?: string) {
  try {
    const response = await api.get('/api/v1/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/** Rotate refresh token and receive a new access token */
export async function refreshToken() {
  try {
    const response = await api.post('/api/v1/auth/refresh-token');
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Mark onboarding as complete for the current user.
 * Note: we pass token explicitly to guarantee the Authorization header is present.
 */
export async function completeOnboarding(token?: string) {
  try {
    const response = await api.post(
      '/api/v1/auth/onboarding/complete',
      null,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
    );
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export default api;