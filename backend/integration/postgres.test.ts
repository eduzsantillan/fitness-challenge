import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSchema } from 'better-auth/db';
import { createRuntime } from '../src/runtime.js';
import { readConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { tokenHash } from '../src/service.js';
import { grantRuntimeAccess } from '../src/database-access.js';
const origin = 'https://ritmo.example', password = 'Test-password-strong-42';
const runtime = createRuntime({ ...readConfig(), origin });
const db = new PostgresRepository(runtime.pool);
let alice = '', bob = '', stranger = '', aliceId = '', bobId = '';
const today = new Date().toISOString().slice(0, 10);
async function request(path: string, method = 'GET', body?: unknown, cookie = alice, extra: Record<string, string> = {}) {
  return runtime.handler(new Request(`${origin}/api${path}`, { method, headers: { origin, 'content-type': 'application/json', 'x-real-ip': '198.51.100.10', cookie, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function signup(name: string) {
  const r = await request('/auth/sign-up/email', 'POST', { name, email: `${name}@example.test`, password }, '');
  expect(r.status, await r.clone().text()).toBe(200);
  return { cookie: r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '), value: await r.json() as { user: { id: string } } };
}
async function group() {
  const r = await request('/challenges', 'POST', { title: 'Prueba Postgres', startDate: today, endDate: today, timeZone: 'UTC', shareConsent: true });
  expect(r.status, await r.clone().text()).toBe(200); return (await r.json()).challenge.id as string;
}
async function connect(id: string, cookie = alice) {
  const r = await request(`/challenges/${id}/connection`, 'POST', {}, cookie); expect(r.status).toBe(200); return (await r.json()).token as string;
}
const activity = (steps = 4856) => ({ date: today, steps, timeZone: 'UTC' });
const ingest = (token: string, body: unknown = activity()) => request('/shortcuts', 'POST', body, '', { authorization: `Bearer ${token}`, origin: '' });
beforeAll(async () => {
  await migrate(runtime.pool); await migrate(runtime.pool); // Applying twice is safe and checksum-checked.
  const a = await signup('alice'), b = await signup('bob'), s = await signup('stranger');
  alice = a.cookie; bob = b.cookie; stranger = s.cookie; aliceId = a.value.user.id; bobId = b.value.user.id;
});
afterAll(async () => { await runtime.pool.end(); });
describe('real PostgreSQL and Better Auth', () => {
  it('matches the installed auth library schema, not a hand-waved mock', async () => {
    const schema = getSchema(runtime.auth.options);
    for (const [table, definition] of Object.entries(schema)) {
      const columns = (await runtime.pool.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [table])).rows.map(r => r.column_name);
      for (const key of Object.keys(definition.fields)) expect(columns, `${table}.${key}`).toContain(key);
    }
  });
  it('stores password hashes, uses Secure HttpOnly cookies, never returns session tokens', async () => {
    expect(alice).toContain('__Secure-');
    const login = await request('/auth/sign-in/email', 'POST', { email: 'alice@example.test', password }, '');
    expect(login.status).toBe(200); expect(login.headers.get('set-cookie')).toMatch(/HttpOnly/i); expect(login.headers.get('set-cookie')).toMatch(/Secure/i);
    expect(await login.text()).not.toContain('token');
    const account = (await runtime.pool.query('SELECT password FROM auth_account WHERE "userId"=$1', [aliceId])).rows[0];
    expect(account.password).not.toBe(password); expect(account.password.length).toBeGreaterThan(64);
    const s = await request('/session'); expect(await s.json()).toEqual({ user: { id: aliceId, name: 'alice', email: 'alice@example.test' } });
    expect((await request('/me', 'GET', undefined, '', { authorization: 'Bearer local-alice' })).status).toBe(401);
    expect((await runtime.pool.query('SELECT "ipAddress", "userAgent" FROM auth_session WHERE "userId"=$1', [aliceId])).rows[0]).toEqual({ ipAddress: null, userAgent: null });
  });
  it('rejects wrong passwords, short passwords, cross-origin sign-ins and raw auth session access', async () => {
    expect((await request('/auth/sign-in/email', 'POST', { email: 'alice@example.test', password: 'wrong-password-42' }, '')).status).toBe(401);
    expect((await request('/auth/sign-up/email', 'POST', { name: 'short', email: 'short@example.test', password: 'tiny' }, '')).status).toBe(400);
    expect((await request('/auth/sign-in/email', 'POST', { email: 'alice@example.test', password }, '', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await request('/auth/get-session')).status).toBe(404);
  });
  it('shares only with consenting members and updates names through profile joins', async () => {
    const id = await group();
    expect((await request(`/challenges/${id}/leaderboard`, 'GET', undefined, stranger)).status).toBe(403);
    const invite = await request(`/challenges/${id}/invites`, 'POST', {}), token = (await invite.json()).token;
    expect((await request('/join', 'POST', { token }, bob)).status).toBe(400);
    expect((await request('/join', 'POST', { token, shareConsent: true }, bob)).status).toBe(200);
    expect((await request(`/challenges/${id}/invites`, 'POST', {}, bob)).status).toBe(403);
    await request('/me', 'PUT', { displayName: 'Alice nueva' });
    const board = await request(`/challenges/${id}/leaderboard`, 'GET', undefined, bob);
    expect((await board.json()).rows.find((r: { userId: string }) => r.userId === aliceId).displayName).toBe('Alice nueva');
  });
  it('upserts daily snapshots, ignores older writes, and preserves manual workout atomically', async () => {
    const id = await group(), token = await connect(id);
    await request(`/challenges/${id}/activity`, 'PUT', { days: [{ date: today, steps: 4000, workoutSeconds: 2700, capturedAt: new Date(Date.now() - 10000).toISOString() }] });
    expect((await ingest(token)).status).toBe(200); expect((await ingest(token)).status).toBe(200);
    expect((await ingest(token, { ...activity(1), capturedAt: new Date(Date.now() - 60000).toISOString() })).status).toBe(200);
    const rows = await db.activity(id); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ steps: 4856, workoutSeconds: 2700, source: 'mixed' });
    expect((await request(`/challenges/${id}/leaderboard`, 'GET', undefined, '', { authorization: `Bearer ${token}` })).status).toBe(401);
  });
  it('rotates concurrent keys so only one survives and rejects an expired key', async () => {
    const id = await group(); const tokens = await Promise.all([connect(id), connect(id)]);
    const active = await db.activeConnection(id, aliceId); expect(active).toBeDefined();
    for (const token of tokens) expect((await ingest(token)).status).toBe(tokenHash(token) === active!.hash ? 200 : 401);
    await runtime.pool.query('UPDATE shortcut_connections SET expires_at=0 WHERE challenge_id=$1', [id]);
    expect((await ingest(tokens.find(t => tokenHash(t) === active!.hash)!)).status).toBe(401);
  });
  it('does not resurrect a record when clear/revoke wins a race with a late write', async () => {
    const id = await group(), token = await connect(id);
    const client = await runtime.pool.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [id]);
    const late = db.saveActivity(id, aliceId, [{ date: today, steps: 9000, workoutSeconds: null, capturedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), source: 'shortcuts' }], tokenHash(token)).then(() => null, error => error);
    await client.query('DELETE FROM shortcut_connections WHERE challenge_id=$1', [id]); await client.query('DELETE FROM daily_activity WHERE challenge_id=$1', [id]);
    await client.query('COMMIT'); client.release();
    expect(await late).toMatchObject({ status: 401 }); expect(await db.activity(id)).toHaveLength(0);
  });
  it('cascades member and challenge deletion to activity, credentials and invitations', async () => {
    const id = await group(), invite = await request(`/challenges/${id}/invites`, 'POST', {}), inviteToken = (await invite.json()).token;
    await request('/join', 'POST', { token: inviteToken, shareConsent: true }, bob);
    const token = await connect(id, bob); await ingest(token);
    await request(`/challenges/${id}/membership`, 'DELETE', {}, bob);
    expect((await ingest(token)).status).toBe(401); expect(await db.activity(id)).toHaveLength(0); expect(await db.member(id, bobId)).toBeUndefined();
    await request(`/challenges/${id}/membership`, 'DELETE', {});
    expect(await db.challenge(id)).toBeUndefined(); expect(await db.invite(tokenHash(inviteToken))).toBeUndefined();
  });
  it('atomically limits concurrent requests in Postgres and stores only HMAC identifiers', async () => {
    const key = 'private-rate-key@example.test';
    const results = await Promise.all(Array.from({ length: 25 }, () => runtime.limiter.consume(key, { window: 60, max: 5 })));
    expect(results.filter(r => r.allowed)).toHaveLength(5);
    expect((await runtime.pool.query('SELECT key FROM request_limits')).rows.every(row => /^[0-9a-f]{64}$/.test(row.key))).toBe(true);
  });
  it('requires explicit data deletion and revokes sessions on sign-out', async () => {
    expect((await request('/me/data', 'DELETE', {})).status).toBe(400);
    expect((await request('/me/data', 'DELETE', { confirm: 'DELETE' })).status).toBe(200);
    expect(await db.challenges(aliceId)).toHaveLength(0);
    expect((await request('/auth/sign-out', 'POST', {})).status).toBe(200);
    expect((await request('/me')).status).toBe(401);
  });
  it('enforces the configured authentication limit across real requests', async () => {
    const attempts = [];
    for (let i = 0; i < 11; i++) attempts.push((await request('/auth/sign-in/email', 'POST', { email: 'nobody@example.test', password: 'wrong-password-123' }, '', { 'x-real-ip': '203.0.113.40' })).status);
    expect(attempts.slice(0, 10)).toEqual(Array(10).fill(401)); expect(attempts[10]).toBe(429);
  });
  it('runs authentication with a non-owner runtime role that cannot perform DDL or edit migrations', async () => {
    await runtime.pool.query('CREATE ROLE ritmo_limited_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
    await runtime.pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await grantRuntimeAccess(runtime.pool, 'ritmo_limited_test');
    const url = new URL(process.env.TEST_DATABASE_URL!); url.username = 'ritmo_limited_test';
    const limited = createRuntime({ ...readConfig(), databaseURL: url.toString(), origin });
    try {
      const rights = (await limited.pool.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS ddl, has_table_privilege(current_user,'ritmo_migrations','UPDATE') AS metadata")).rows[0];
      expect(rights).toEqual({ ddl: false, metadata: false });
      const signup = await limited.handler(new Request(`${origin}/api/auth/sign-up/email`, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-real-ip': '203.0.113.101' }, body: JSON.stringify({ name: 'Limited', email: 'limited@example.test', password }) }));
      expect(signup.status, await signup.clone().text()).toBe(200);
    } finally { await limited.pool.end(); }
  });
});
