import { Queue, Worker } from 'bullmq';

// BullMQ gère sa propre connexion Redis (ioredis en interne) — on lui passe
// juste les infos de connexion, séparément du client `redis` déjà utilisé
// pour le cache et le géo-index (src/config/redis.js).
function buildConnectionOptions() {
  const url = (process.env.DOCKER_CONTAINER === 'true' || process.env.NODE_ENV === 'production')
    ? (process.env.REDIS_URL || 'redis://redis:6379')
    : (process.env.REDIS_URL_LOCAL || process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 6379,
      password: u.password || undefined,
      maxRetriesPerRequest: null, // requis par BullMQ pour les workers
    };
  } catch {
    return { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null };
  }
}

export const queueConnection = buildConnectionOptions();

export const CITY_STARS_QUEUE = 'city-stars-recalc';

export const cityStarsQueue = new Queue(CITY_STARS_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    // Le recalcul est idempotent (relit les Events et réécrit la popularité) :
    // pas besoin de retenir l'historique des jobs terminés ni de retries agressifs.
    removeOnComplete: true,
    removeOnFail: 50,
    attempts: 2,
  },
});

let cityStarsWorker = null;

// Démarre le worker qui consomme la queue. En mode cluster PM2, chaque
// instance peut lancer son propre worker sans risque de double-traitement :
// BullMQ distribue les jobs de façon atomique entre workers (contrairement
// aux cron schedules, qui eux créeraient un job par instance).
export function startCityStarsWorker(processFn) {
  if (cityStarsWorker) return cityStarsWorker;
  cityStarsWorker = new Worker(
    CITY_STARS_QUEUE,
    async (job) => processFn(job.data.city ?? null),
    { connection: queueConnection, concurrency: 2 },
  );
  cityStarsWorker.on('failed', (job, err) => {
    console.warn(`[queue:${CITY_STARS_QUEUE}] Job failed (city=${job?.data?.city}):`, err.message);
  });
  return cityStarsWorker;
}

export const STRIPE_WEBHOOK_QUEUE = 'stripe-webhook-processing';

export const stripeWebhookQueue = new Queue(STRIPE_WEBHOOK_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 500,
    removeOnFail: false, // on garde les échecs : Stripe ne re-livrera plus le webhook une fois ack, ce job devient la seule trace pour rejouer manuellement
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

let stripeWebhookWorker = null;

export function startStripeWebhookWorker(processFn) {
  if (stripeWebhookWorker) return stripeWebhookWorker;
  stripeWebhookWorker = new Worker(
    STRIPE_WEBHOOK_QUEUE,
    async (job) => processFn(job.data.event),
    { connection: queueConnection, concurrency: 5 },
  );
  stripeWebhookWorker.on('failed', (job, err) => {
    console.error(`[queue:${STRIPE_WEBHOOK_QUEUE}] Job failed after ${job?.attemptsMade} attempts (event=${job?.data?.event?.id}, type=${job?.data?.event?.type}):`, err.message);
  });
  return stripeWebhookWorker;
}

// Le transcodage vidéo (ffmpeg) est l'opération la plus coûteuse en CPU du backend :
// elle bloquait auparavant la requête HTTP d'upload (addStory/addEvent). On la sort
// du cycle requête/réponse pour que l'API reste réactive même sous charge d'upload.
export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const videoProcessingQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 2,
  },
});

let videoProcessingWorker = null;

// concurrency: 1 car ffmpeg sature déjà un cœur CPU par job ; augmenter ferait
// juste ralentir chaque transcodage individuel sans réduire le débit global.
export function startVideoProcessingWorker(processFn) {
  if (videoProcessingWorker) return videoProcessingWorker;
  videoProcessingWorker = new Worker(
    VIDEO_PROCESSING_QUEUE,
    async (job) => processFn(job.data),
    { connection: queueConnection, concurrency: 1 },
  );
  videoProcessingWorker.on('failed', (job, err) => {
    console.error(`[queue:${VIDEO_PROCESSING_QUEUE}] Job failed (locationId=${job?.data?.locationId}, kind=${job?.data?.kind}):`, err.message);
  });
  return videoProcessingWorker;
}

export const EMAIL_QUEUE = 'email-send';

export const emailQueue = new Queue(EMAIL_QUEUE, {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 100,
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
  },
});

let emailWorker = null;

export function startEmailWorker(sendMailFn) {
  if (emailWorker) return emailWorker;
  emailWorker = new Worker(
    EMAIL_QUEUE,
    async (job) => sendMailFn(job.data),
    { connection: queueConnection, concurrency: 5 },
  );
  emailWorker.on('failed', (job, err) => {
    console.error(`[queue:${EMAIL_QUEUE}] Job failed after ${job?.attemptsMade} attempts (to=${job?.data?.to}):`, err.message);
  });
  return emailWorker;
}
