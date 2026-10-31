import pg from 'pg';
export type Config = { databaseURL: string; origin: string; secret: string; poolMax: number };
export function readConfig(env = process.env): Config {
  if (!env.DATABASE_URL || !env.APP_ORIGIN || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) throw new Error('Faltan DATABASE_URL, APP_ORIGIN o BETTER_AUTH_SECRET (mínimo 32 caracteres).');
  const origin = new URL(env.APP_ORIGIN), db = new URL(env.DATABASE_URL);
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (origin.origin !== env.APP_ORIGIN || origin.username || origin.password || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && local(origin.hostname) && env.VERCEL_ENV !== 'production'))) throw new Error('APP_ORIGIN debe ser el origen HTTPS exacto, sin ruta ni barra final.');
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw new Error('DATABASE_URL debe ser PostgreSQL.');
  // Keep TLS certificate verification enabled for remote Neon/PostgreSQL.
  if (!local(db.hostname)) { db.searchParams.set('sslmode', 'verify-full'); }
  const poolMax = Number(env.PG_POOL_MAX ?? 3);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 10) throw new Error('PG_POOL_MAX debe estar entre 1 y 10.');
  return { databaseURL: db.toString(), origin: origin.origin, secret: env.BETTER_AUTH_SECRET, poolMax };
}
export function createPool(config: Config) {
  const pool = new pg.Pool({ connectionString: config.databaseURL, max: config.poolMax, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, allowExitOnIdle: true });
  pool.on('error', () => { console.error('database_pool_error'); });
  return pool;
}
export function readMigrationConfig(env = process.env): Config {
  const runtime = readConfig(env);
  if (!env.MIGRATION_DATABASE_URL) return runtime;
  const migration = readConfig({ ...env, DATABASE_URL: env.MIGRATION_DATABASE_URL });
  const app = new URL(runtime.databaseURL), owner = new URL(migration.databaseURL);
  const endpoint = (url: URL) => url.hostname.replace('-pooler.', '.');
  if (app.pathname !== owner.pathname || endpoint(app) !== endpoint(owner) || app.port !== owner.port) throw new Error('Las conexiones de runtime y migración deben apuntar a la misma base y endpoint.');
  return migration;
}
