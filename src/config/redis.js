import { createClient } from 'redis';

const url = process.env.REDIS_URL || process.env.REDIS_URL_LOCAL || 'redis://127.0.0.1:6379';
export const redisClient = createClient({ url });

redisClient.on('error', (err) => {
  console.warn('Redis Client Error:', err.message);
});
