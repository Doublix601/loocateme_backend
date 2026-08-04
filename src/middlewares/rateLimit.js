import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redisClient } from '../config/redis.js';

// Protège les endpoints les plus fréquemment appelés par l'app (heartbeat en
// continu, liste de lieux à proximité) contre un client buggé ou abusif, sans
// gêner un usage normal : l'app envoie au plus 1 heartbeat / 30s et 1 fetch
// de liste / ~10-15s (throttle par déplacement de ~111m côté client).
//
// Store Redis partagé (au lieu du store en mémoire par défaut) : en cluster
// PM2 (3 workers), un store en mémoire donne un compteur par worker, donc une
// limite réelle jusqu'à 3x plus large que la valeur nominale ci-dessous. Le
// store Redis rend la limite réelle en cluster.
//
// Construction paresseuse : le constructeur de RedisStore précharge un script
// Lua via sendCommand, ce qui échoue si Redis n'est pas encore connecté. Or
// ces limiteurs sont instanciés au chargement des routes (import statique),
// donc avant `redisClient.connect()` (appelé plus tard dans le démarrage
// async de src/server.js). On défère la construction du vrai RedisStore
// jusqu'au premier appel réel (increment), qui n'arrive qu'à la première
// requête HTTP, largement après la connexion Redis.
function lazyRedisStore() {
  let real = null;
  let pendingInit = null;
  const ensure = () => {
    if (!real) {
      real = new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
      });
      if (pendingInit) real.init(pendingInit);
    }
    return real;
  };
  return {
    init: (options) => {
      pendingInit = options;
    },
    increment: (key) => ensure().increment(key),
    decrement: (key) => ensure().decrement(key),
    resetKey: (key) => ensure().resetKey(key),
  };
}

export const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20, // largement au-dessus du rythme normal (~1-2 req/min/user)
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  store: lazyRedisStore(),
  message: { code: 'RATE_LIMITED', message: 'Too many location updates' },
});

export const locationsListLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  store: lazyRedisStore(),
  message: { code: 'RATE_LIMITED', message: 'Too many requests' },
});

// Endpoint public (sans auth) exposé par le site loocate.me : limite large
// mais suffisante pour contrer le spam par IP sans gêner un usage normal.
export const supportContactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'RATE_LIMITED', message: 'Trop de messages envoyés, réessayez plus tard.' },
});

// Anti-bruteforce sur la connexion : par IP (un attaquant peut cibler des
// emails différents) et volontairement strict, un utilisateur légitime ne
// se trompe pas 10 fois de mot de passe en une minute.
export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'RATE_LIMITED', message: 'Trop de tentatives de connexion, réessayez plus tard.' },
});

// Anti-abus sur la création de compte (énumération d'emails via EMAIL_TAKEN,
// spam de comptes) : par IP, plus permissif que le login.
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'RATE_LIMITED', message: 'Trop de tentatives de création de compte, réessayez plus tard.' },
});

// Anti-bruteforce sur la saisie d'un code de parrainage (8 caractères, éviter
// le guessing en masse d'un code appartenant à quelqu'un d'autre) : par user.
export const referralRedeemLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  store: lazyRedisStore(),
  message: { code: 'RATE_LIMITED', message: 'Trop de tentatives, réessayez plus tard.' },
});

// Anti-spam sur la demande de reset password (déclenche un envoi d'email à
// chaque appel) : par IP, fenêtre plus large.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { code: 'RATE_LIMITED', message: 'Trop de demandes de réinitialisation, réessayez plus tard.' },
});
