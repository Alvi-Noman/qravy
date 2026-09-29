/**
 * Error carrying an HTTP status — thrown by reusable "core" functions that
 * don't have access to `res`, and translated to `res.fail` by the handler.
 */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Request-independent context for write operations (audit + ownership). */
export type WriteCtx = {
  userId: string;
  tenantId: string;
  ip: string;
  userAgent: string;
};
