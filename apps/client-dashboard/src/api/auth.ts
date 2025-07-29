import axios, { AxiosError } from 'axios';
import { useMutation } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface LoginCredentials {
  email: string;
  password: string;
}

interface SignupCredentials {
  email: string;
  password: string;
  name: string;
}

interface AuthResponse {
  token: string;
  user: { id: string; email: string; name: string };
}

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const useLogin = () => {
  return useMutation<AuthResponse, AxiosError, LoginCredentials>({
    mutationFn: async (credentials) => {
      const response = await axios.post<AuthResponse>(`${API_BASE_URL}/api/auth/login`, credentials);
      localStorage.setItem('token', response.data.token);
      return response.data;
    },
    onError: () => {},
  });
};

export const useSignup = () => {
  return useMutation<AuthResponse, AxiosError, SignupCredentials>({
    mutationFn: async (credentials) => {
      const response = await axios.post<AuthResponse>(`${API_BASE_URL}/api/auth/signup`, credentials);
      localStorage.setItem('token', response.data.token);
      return response.data;
    },
    onError: () => {},
  });
};