import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type HandlerOptions } from '../src/handler.js';
import { MemoryRepository } from '../src/memory-repository.js';
import { ChallengeService } from '../src/service.js';
import { readConfig, readMigrationConfig } from '../src/config.js';
const origin = 'https://ritmo.example';
let handler: ReturnType<typeof createHandler>, options: HandlerOptions;
function request(path: string, method = 'GET', body?: string, extra?: Record<string, string>) {
  return handler(new Request(`${origin}/api${path}`, { method, headers: { origin, 'content-type': 'application/json', ...extra }, ...(body === undefined ? {} : { body }) }));
}
beforeEach(() => {
  options = { origin, user: async () => null, auth: async () => Response.json({ success: true }) };
  handler = createHandler(new ChallengeService(new MemoryRepository()), options);
});
describe('same-origin API boundary', () => {
  it('rejects missing session and the former local bearer bypass', async () => { expect((await request('/me')).status).toBe(401); expect((await request('/me', 'GET', undefined, { authorization: 'Bearer local-alice' })).status).toBe(401); });
  it('takes identity from the verified session, never body or bearer', async () => {
    options.user = async () => ({ id: 'alice', name: 'Alice', email: 'alice@example.test' });
    const r = await request('/me', 'PUT', JSON.stringify({ displayName: 'Alice', userId: 'bob' })); expect((await r.json()).userId).toBe('alice'); expect(r.headers.get('cache-control')).toBe('no-store');
  });
  it('requires exact origin on mutations; preflight does not grant CORS', async () => {
    expect((await request('/me', 'PUT', '{}', { origin: 'https://evil.example' })).status).toBe(403);
    const preflight = await request('/me', 'OPTIONS'); expect(preflight.status).toBe(204); expect(preflight.headers.has('access-control-allow-origin')).toBe(false);
    expect((await request('/session', 'GET', undefined, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
  it('rejects arrays, invalid JSON, non-JSON content and oversized bodies', async () => {
    for (const body of ['[]', '{bad']) expect((await request('/me', 'PUT', body)).status).toBe(400);
    expect((await request('/me', 'PUT', '{}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await request('/me', 'PUT', JSON.stringify({ s: 'x'.repeat(24000) }))).status).toBe(413);
  });
  it('does not expose auth tokens in JSON and preserves cookies', async () => {
    options.auth = vi.fn(async () => Response.json({ token: 'private-token', user: { id: 'alice', name: 'Alice', email: 'alice@example.test', password: 'hidden' } }, { headers: { 'set-cookie': 'session=private; HttpOnly; Secure' } }));
    const result = await request('/auth/sign-in/email', 'POST', '{}'); const text = await result.text();
    expect(text).not.toContain('private-token'); expect(text).not.toContain('hidden'); expect(result.headers.get('set-cookie')).toContain('HttpOnly');
    expect((await request('/auth/get-session')).status).toBe(404);
  });
  it('rejects non-JSON auth posts and returns rate-limit retry headers', async () => {
    options.limit = async () => ({ allowed: false, retryAfter: 30 });
    const result = await request('/me'); expect(result.status).toBe(429); expect(result.headers.get('retry-after')).toBe('30');
  });
});
describe('server configuration', () => {
  const env = { DATABASE_URL: 'postgresql://u:p@neon.example/db?sslmode=require', APP_ORIGIN: origin, BETTER_AUTH_SECRET: 'x'.repeat(48) };
  it('fails closed without secrets, with wrong origins or unbounded pool size', () => {
    expect(() => readConfig({})).toThrow();
    for (const change of [{ APP_ORIGIN: `${origin}/` }, { APP_ORIGIN: 'http://example.com' }, { BETTER_AUTH_SECRET: 'short' }, { PG_POOL_MAX: '100' }]) expect(() => readConfig({ ...env, ...change })).toThrow();
  });
  it('enables TLS certificate verification for remote Postgres', () => { expect(readConfig(env).databaseURL).toContain('sslmode=verify-full'); });
  it('keeps migration credentials out of runtime and refuses a different database/endpoint', () => {
    const separate = { ...env, MIGRATION_DATABASE_URL: 'postgresql://migrator:private@neon.example/db' };
    expect(new URL(readConfig(separate).databaseURL).username).toBe('u');
    expect(new URL(readMigrationConfig(separate).databaseURL).username).toBe('migrator');
    expect(() => readMigrationConfig({ ...separate, MIGRATION_DATABASE_URL: 'postgresql://migrator:private@neon.example/other_database' })).toThrow('misma base');
    expect(() => readMigrationConfig({ ...separate, MIGRATION_DATABASE_URL: 'postgresql://migrator:private@other.example/db' })).toThrow('misma base');
  });
});
