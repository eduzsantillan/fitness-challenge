import { createAuth } from './auth.js';
import { createPool, readConfig } from './config.js';
import { createHandler, json } from './handler.js';
import { PostgresRepository } from './postgres-repository.js';
import { RateLimiter } from './rate-limit.js';
import { ChallengeService } from './service.js';
export function createRuntime(config = readConfig()) {
  const pool = createPool(config), limiter = new RateLimiter(pool, config.secret), auth = createAuth(pool, config, limiter);
  const handler = createHandler(new ChallengeService(new PostgresRepository(pool), undefined, config.secret), {
    origin: config.origin, auth: request => auth.handler(request), limit: (key, rule) => limiter.consume(key, rule),
    user: async request => { const result = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true, disableRefresh: true } }); return result?.user ?? null; },
  });
  return { handler, pool, auth, limiter };
}
let runtime: ReturnType<typeof createRuntime> | undefined;
export async function handleRequest(request: Request) {
  try { runtime ??= createRuntime(); }
  catch { return json({ configured: false, message: 'Falta configurar el servidor. Consulta la guía de Vercel y Neon.' }, 503); }
  return runtime.handler(request);
}
