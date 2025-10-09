export function notFound(req, res, next) {
  res.status(404).json({ code: 'ROUTE_NOT_FOUND', message: 'Route not found' });
}

export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || inferCodeFromStatus(status) || 'ERROR';
  res.status(status).json({ code, message, details: err.details || undefined });
}

function inferCodeFromStatus(status) {
  if (status === 400) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE_ENTITY';
  if (status >= 500) return 'INTERNAL_ERROR';
  return undefined;
}
