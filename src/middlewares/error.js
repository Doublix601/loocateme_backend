export function notFound(req, res, next) {
  res.status(404).json({ message: 'Route not found' });
}

export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ message, details: err.details || undefined });
}
