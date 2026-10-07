import { AppError, badRequest } from '../errors.ts';

/** AppError messages are written to be safe for clients. Anything else becomes a generic 500 (details go to server logs only). */
export function toErrorResponse(err: unknown, requestId?: string) {
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message, requestId } } };
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Internal server error', requestId } } };
}

export function parsePagination(
  q: Record<string, string | undefined>,
  opts: { sortable: readonly string[]; defaultSort: string; maxPageSize?: number },
) {
  const max = opts.maxPageSize ?? 100;
  const int = (v: string | undefined, def: number) => {
    if (v === undefined) return def;
    if (!/^\d+$/.test(v)) throw badRequest('Pagination values must be positive integers');
    return Number(v);
  };
  const page = int(q.page, 1), pageSize = int(q.pageSize, 20);
  if (page < 1 || pageSize < 1 || pageSize > max) throw badRequest(`page must be >= 1 and pageSize between 1 and ${max}`);
  const sort = q.sort ?? opts.defaultSort;
  if (!opts.sortable.includes(sort)) throw badRequest('Unsupported sort field'); // whitelist: never pass client strings to the ORM
  const order = q.order ?? 'asc';
  if (order !== 'asc' && order !== 'desc') throw badRequest('order must be asc or desc');
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize, orderBy: { [sort]: order } as Record<string, 'asc' | 'desc'> };
}
