import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/**
 * API base URL, configurable via Vite env.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

/**
 * Axios instance for all API requests.
 */
const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // Always send cookies (for refresh token, etc.)
});

/**
 * Endpoints that do NOT require authentication or token refresh.
 */
const PUBLIC_ENDPOINTS = [
  '/magic-link',
  '/signup',
  '/login',
  '/verify',
];

/**
 * Attach authentication and refresh logic to the Axios instance.
 * Skips refresh for public endpoints.
 */
export const attachAuthInterceptor = (
  getToken: () => string | null,
  refreshToken: () => Promise<void>,
  logout: () => void
) => {
  // Attach JWT to outgoing requests if available
  api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // Handle 401 errors: try to refresh token, except for public endpoints
  api.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      // --- Debug: Log the URL being checked ---
      console.log('AXIOS INTERCEPTOR:', originalRequest.url);

      // Skip refresh logic for public endpoints (no auth required)
      if (
        originalRequest.url?.includes('/magic-link') ||
        originalRequest.url?.includes('/signup') ||
        originalRequest.url?.includes('/login') ||
        originalRequest.url?.includes('/verify')
      ) {
        console.log('Skipping refresh for public endpoint:', originalRequest.url);
        return Promise.reject(error);
      }

      // Attempt token refresh once on 401
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

/**
 * Extracts a user-friendly error message from any error object.
 */
function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const msg =
      error.response?.data?.message ||
      error.message ||
      'Request failed';
    return msg;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Request failed';
}

/**
 * Sends a magic login link to the specified email address.
 * @param email User's email address
 */
export async function sendMagicLink(email: string) {
  try {
    await api.post('/api/v1/auth/magic-link', { email });
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Verifies a magic link token and logs the user in.
 * @param token Magic link token from email
 * @returns Auth data (token, user)
 */
export async function verifyMagicLink(token: string) {
  try {
    const response = await api.get(`/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Fetches the current user's profile.
 * @param token Optional JWT for manual override
 * @returns User data
 */
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

/**
 * Refreshes the access token using the refresh token cookie.
 * @returns New auth data
 */
export async function refreshToken() {
  try {
    const response = await api.post('/api/v1/auth/refresh-token');
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Fetches the menu for the logged-in user's restaurant.
 * @returns Array of menu items
 */
export async function fetchDashboardMenu() {
  try {
    const response = await api.get('/api/v1/dashboard');
    return response.data.menu;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

/**
 * Marks onboarding as complete for the current user.
 */
export async function completeOnboarding() {
  try {
    await api.post('/api/v1/auth/onboarding/complete');
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export default api;