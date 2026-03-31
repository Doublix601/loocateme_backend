import { createClient } from 'redis';

const url = (process.env.DOCKER_CONTAINER === 'true' || process.env.NODE_ENV === 'production')
  ? (process.env.REDIS_URL || 'redis://redis:6379')
  : (process.env.REDIS_URL_LOCAL || process.env.REDIS_URL || 'redis://127.0.0.1:6379');
export const redisClient = createClient({ url });

redisClient.on('error', (err) => {
  console.warn('Redis Client Error:', err.message);
});
