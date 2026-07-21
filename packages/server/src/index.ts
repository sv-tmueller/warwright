import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
const app = buildApp({
  db,
  pool,
  session: { secret: config.sessionSecret, cookieSecure: config.cookieSecure },
  queue: {
    windowMs: config.queueWindowMs,
    maxPool: config.queueMaxPool,
    maxFailures: config.queueMaxFailures,
    maxAgeMs: config.queueMaxAgeMs,
  },
});

app
  .listen({ port: config.port, host: config.host })
  .then((address) => {
    app.log.info(`@warwright/server listening on ${address}`);
  })
  .catch((error: unknown) => {
    app.log.error(error);
    process.exit(1);
  });
