import type { HttpHandler } from 'msw';
import { authHandlers } from './auth';
import { menuHandlers } from './menu';
import { uploadHandlers } from './uploads';

export const handlers: HttpHandler[] = [
...authHandlers,
...menuHandlers,
...uploadHandlers,
];