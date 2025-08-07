import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { useMutation } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

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

// Helper to extract a user-friendly error message from Axios errors
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

export async function sendMagicLink(email: string) {
  try {
    await api.post('/api/v1/auth/magic-link', { email });
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

export async function verifyMagicLink(token: string) {
  try {
    const response = await api.get(`/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
    return response.data;
  } catch (error) {
    throw new Error(extractErrorMessage(error));
  }
}

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

export default api;