import rateLimit from 'express-rate-limit';

// Protège les endpoints les plus fréquemment appelés par l'app (heartbeat en
// continu, liste de lieux à proximité) contre un client buggé ou abusif, sans
// gêner un usage normal : l'app envoie au plus 1 heartbeat / 30s et 1 fetch
// de liste / ~10-15s (throttle par déplacement de ~111m côté client).

export const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // largement au-dessus du rythme normal (~1-2 req/min/user)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { code: 'RATE_LIMITED', message: 'Too many location updates' },
});

export const locationsListLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { code: 'RATE_LIMITED', message: 'Too many requests' },
});
