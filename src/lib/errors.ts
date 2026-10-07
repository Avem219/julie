export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}
export const unauthenticated = (m = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', m);
export const forbidden = (m = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Resource not found') => new AppError(404, 'NOT_FOUND', m);
export const badRequest = (m: string) => new AppError(400, 'BAD_REQUEST', m);
export const conflict = (m: string) => new AppError(409, 'CONFLICT', m);
export const tooManyRequests = (m = 'Too many requests') => new AppError(429, 'RATE_LIMITED', m);
