import axios, { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { useMutation } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface MagicLinkCredentials {
  email: string;
}

interface AuthResponse {
  token: string;
  user: { id: string; email: string };
}

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

export async function sendMagicLink(email: string) {
  await api.post('/api/v1/auth/magic-link', { email });
}

export async function verifyMagicLink(token: string) {
  const response = await api.get(`/api/v1/auth/magic-link/verify?token=${encodeURIComponent(token)}`);
  return response.data;
}

// Updated: Accepts an optional token parameter
export async function getMe(token?: string) {
  const response = await api.get('/api/v1/auth/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return response.data;
}

export default api;