import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

import { connectMongo } from './config/mongo.js';
import { ensureDefaultFlags } from './models/FeatureFlag.js';
import { redisClient } from './config/redis.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import profileRoutes from './routes/profile.routes.js';
import socialRoutes from './routes/social.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import gdprRoutes from './routes/gdpr.routes.js';
import adminRoutes from './routes/admin.routes.js';
import eventsRoutes from './routes/events.routes.js';
import statsRoutes from './routes/stats.routes.js';
import pushRoutes from './routes/push.routes.js';
import premiumRoutes from './routes/premium.routes.js';
import proxyRoutes from './routes/proxy.routes.js';
import reportRoutes from './routes/report.routes.js';
import blocksRoutes from './routes/blocks.routes.js';
import followRoutes from './routes/follow.routes.js';
import locationRoutes from './routes/location.routes.js';
import iapRoutes from './routes/iap.routes.js';
import businessClaimRoutes from './routes/businessClaim.routes.js';
import businessProfileRoutes from './routes/businessProfile.routes.js';
import businessBillingRoutes from './routes/businessBilling.routes.js';
import businessBoostRoutes from './routes/businessBoost.routes.js';
import supportRoutes from './routes/support.routes.js';
import { BusinessBillingController } from './controllers/businessBilling.controller.js';
import { errorHandler, notFound } from './middlewares/error.js';
import { verifyMailTransport } from './services/email.service.js';
import { CronService } from './services/cron.service.js';
import { startCityStarsWorker, startStripeWebhookWorker, startEmailWorker, startVideoProcessingWorker } from './config/queue.js';
import { recalculateCityStars } from './services/location.service.js';
import { processVideoJob } from './services/mediaProcessing.service.js';
import { processStripeEvent } from './controllers/businessBilling.controller.js';
import { sendMail } from './services/email.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy so req.protocol respects X-Forwarded-Proto (useful behind reverse proxies)
app.set('trust proxy', 1);

const PORT = process.env.PORT || 4000;
const ORIGIN = process.env.CORS_ORIGIN || '*';
// Supporte une liste d'origines séparées par des virgules (ex: app mobile Expo +
// site Web pro sur un sous-domaine distinct), en plus d'une origine unique ou '*'.
const ALLOWED_ORIGINS = ORIGIN === '*' ? true : ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

app.use(cors({
  origin: ALLOWED_ORIGINS === true
    ? true
    : (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
  credentials: true,
}));
app.use(morgan('dev'));

// Webhook Stripe : DOIT être monté avant express.json() pour recevoir le
// corps brut (nécessaire à la vérification de signature).
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), BusinessBillingController.stripeWebhook);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files (profile images)
const uploadsDir = process.env.UPLOAD_DIR || 'uploads';
app.use('/uploads', express.static(path.join(__dirname, '..', uploadsDir)));

// Diagnostic Middleware: Log every incoming request
app.use((req, res, next) => {
  console.log(`[Request] ${req.method} ${req.originalUrl}`);
  next();
});

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Apple App Site Association & Android Asset Links
app.get(['/apple-app-site-association', '/.well-known/apple-app-site-association'], (req, res) => {
  res.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: 'S87X78358N.me.loocate.app', // TEAM_ID.Bundle_ID
          paths: ['NOT /api/auth/*', '/profile/*', '/*'],
        },
      ],
    },
  });
});

app.get(['/assetlinks.json', '/.well-known/assetlinks.json'], (req, res) => {
  res.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'me.loocate.app',
        sha256_cert_fingerprints: [
          'FA:C6:17:45:DC:09:03:78:6F:B9:ED:46:21:05:91:D0:65:07:34:68:55:A6:5E:F6:6D:73:96:29:A8:4C:E6:B5',
        ],
      },
    },
  ]);
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/users', userRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/gdpr', gdprRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/premium', premiumRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/blocks', blocksRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/iap', iapRoutes);
app.use('/api/business-claims', businessClaimRoutes);
app.use('/api/business', businessProfileRoutes);
app.use('/api/business/billing', businessBillingRoutes);
app.use('/api/business', businessBoostRoutes);
app.use('/api/support', supportRoutes);

// 404 and error
app.use(notFound);
app.use(errorHandler);

// Start server after DB connections
(async () => {
  await connectMongo();
  // Ensure default feature flags exist
  try {
    await ensureDefaultFlags();
    console.log('Feature flags ensured');
  } catch (e) {
    console.warn('Failed to ensure feature flags:', e?.message || e);
  }
  // Ensure indexes are created (notably 2dsphere on location)
  try {
    const { User } = await import('./models/User.js');
    await User.createIndexes();
    // Verify geospatial index exists on `location`
    const indexes = await User.collection.indexes();
    const hasLocationIndex = indexes.some((i) => i.key && i.key.location === '2dsphere');
    if (!hasLocationIndex) {
      await User.collection.createIndex({ location: '2dsphere' }, { name: 'location_2dsphere' });
      console.log('Created missing 2dsphere index on `location`');
    }
    // Optionally drop wrong index on `location.coordinates` if present (not used by $near on GeoJSON)
    const wrongIdx = indexes.find((i) => i.key && i.key['location.coordinates'] === '2dsphere');
    if (wrongIdx) {
      try {
        await User.collection.dropIndex(wrongIdx.name || 'location.coordinates_2dsphere');
        console.log('Dropped incorrect 2dsphere index on `location.coordinates`');
      } catch (dropErr) {
        console.warn('Could not drop incorrect `location.coordinates` index:', dropErr?.message || dropErr);
      }
    }
    console.log('MongoDB indexes ensured for User');
  } catch (e) {
    console.warn('Failed to ensure MongoDB indexes for User:', e?.message || e);
  }
  await redisClient.connect().catch(() => {
    console.warn('Redis connection failed. Continuing without Redis.');
  });
  // Verify SMTP transport at startup to surface configuration issues early
  try {
    const res = await verifyMailTransport();
    if (!res.ok) {
      console.warn('[email] SMTP not ready:', res.error);
    }
  } catch (e) {
    console.warn('[email] SMTP verification threw:', e?.message || e);
  }
  // En mode cluster (pm2 -i N), chaque worker importerait ce module et
  // planifierait les mêmes cron jobs N fois (emails en double, cleanup en
  // double...). NODE_APP_INSTANCE n'est défini que par pm2 en cluster mode ;
  // on ne garde les cron que sur l'instance 0 (absent en dev/nodemon, donc
  // toujours actif hors cluster).
  const pm2InstanceId = process.env.NODE_APP_INSTANCE;
  if (pm2InstanceId === undefined || pm2InstanceId === '0') {
    CronService.init();
  }
  // Contrairement aux cron jobs, BullMQ distribue nativement les jobs entre
  // workers : chaque instance du cluster peut démarrer son propre worker sans
  // risque de double-traitement.
  startCityStarsWorker(recalculateCityStars);
  startStripeWebhookWorker(processStripeEvent);
  startEmailWorker(sendMail);
  startVideoProcessingWorker(processVideoJob);
    app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (listening on 0.0.0.0)`);
    // Log all registered routes
    const routes = [];
    app._router.stack.forEach((middleware) => {
      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
        routes.push(`  [Direct] ${methods.padEnd(7)} ${middleware.route.path}`);
      } else if (middleware.name === 'router') {
        const base = middleware.regexp.toString()
          .replace('/^\\', '')
          .replace('\\/?(?=\\/|$)/i', '')
          .replace(/\\\//g, '/');
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            const path = handler.route.path;
            const methods = Object.keys(handler.route.methods).join(',').toUpperCase();
            routes.push(`  [Route]  ${methods.padEnd(7)} ${base}${path}`);
          }
        });
      }
    });
    console.log('\n=== Registered Routes ===');
    console.log(routes.join('\n'));
    console.log('=========================\n');
  });
})();
