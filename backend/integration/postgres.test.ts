import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSchema } from 'better-auth/db';
import { createRuntime } from '../src/runtime.js';
import { readConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { ChallengeService, tokenHash } from '../src/service.js';
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

describe('simple personal steps with real PostgreSQL', () => {
  let code = '', timeZone = 'UTC';
  const asBob = (path: string, method = 'GET', body?: unknown) => request(path, method, body, bob, { 'x-real-ip': '203.0.113.88' });
  const simple = (userCode = code, steps = 90) => runtime.handler(new Request(`${origin}/api/steps`, { method: 'POST', body: JSON.stringify({ userCode, steps }), headers: { 'x-real-ip': '203.0.113.89' } }));
  beforeAll(async () => {
    const r = await asBob('/me', 'PUT', { timeZone }); expect(r.status, await r.clone().text()).toBe(200); code = (await r.json()).userCode;
  });
  it('generates retrievable capability without storing it plaintext; creates independent personal snapshots without headers', async () => {
    const me = await asBob('/me'); expect((await me.json()).userCode).toBe(code);
    const stored = (await runtime.pool.query('SELECT code_seed,code_hash FROM profiles WHERE user_id=$1', [bobId])).rows[0];
    expect(stored.code_hash).toBe(tokenHash(code)); expect(stored.code_seed).not.toBe(code); expect(JSON.stringify(stored)).not.toContain(code);
    expect((await simple()).status).toBe(200); expect((await simple()).status).toBe(200); expect((await simple(code, 100)).status).toBe(200);
    const history = await asBob('/me/activity'); expect(await history.json()).toMatchObject({ timeZone: 'UTC', days: [{ date: today, steps: 100 }] });
    const another = createRuntime({ ...readConfig(), origin });
    try { const r = await another.handler(new Request(`${origin}/api/me`, { headers: { cookie: bob } })); expect((await r.json()).userCode).toBe(code); }
    finally { await another.pool.end(); }
  });
  it('adds prize and server date, auto-enrols creator; global steps count in multiple joined challenges, private invites show no activity', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await asBob('/challenges', 'POST', { title: 'Reto simple', durationDays: 7, prize: 'Un helado', shareConsent: true });
      expect(c.status, await c.clone().text()).toBe(200); const { challenge } = await c.json(); ids.push(challenge.id);
      expect(challenge).toMatchObject({ startDate: today, prize: 'Un helado', timeZone });
      expect(await db.members(challenge.id)).toHaveLength(1);
      const board = await asBob(`/challenges/${challenge.id}/leaderboard`); expect((await board.json()).rows[0].steps).toBe(100);
    }
    const invite = await asBob(`/challenges/${ids[0]}/invites`, 'POST', {}), token = (await invite.json()).token;
    const preview = await request(`/invites/${token}`, 'GET', undefined, stranger); expect(preview.status).toBe(200);
    const data = await preview.json(); expect(data).toMatchObject({ challenge: { prize: 'Un helado' }, members: [{ displayName: 'bob' }] });
    expect(JSON.stringify(data)).not.toMatch(/userCode|code_hash|steps|capturedAt|userId/);
    expect((await request(`/challenges/${ids[0]}/leaderboard`, 'GET', undefined, stranger)).status).toBe(403);
    await asBob(`/challenges/${ids[0]}/membership`, 'DELETE', {});
    expect((await asBob('/me/activity')).status).toBe(200); expect(await db.personalActivity([bobId])).toHaveLength(1);
  });
  it('calculates local dates around DST from server time, without accepting client overrides', async () => {
    const svc = new ChallengeService(db, () => new Date('2025-11-02T03:30:00Z'), readConfig().secret);
    await svc.handle(bobId, 'PUT', '/me', { timeZone: 'America/Toronto' });
    expect(await svc.ingestSteps({ userCode: code, steps: 123 })).toMatchObject({ date: '2025-11-01' });
    await expect(svc.ingestSteps({ userCode: code, steps: 123, date: '2020-01-01' })).rejects.toMatchObject({ status: 400 });
    await asBob('/me', 'PUT', { timeZone: 'UTC' });
  });
  it('rejects old codes after rotation including a request already queued before revocation', async () => {
    const old = code, next = await asBob('/me/code', 'POST', {}); code = (await next.json()).userCode;
    expect(code).not.toBe(old); expect((await simple(old)).status).toBe(401); expect((await simple()).status).toBe(200);
    const client = await runtime.pool.connect(); await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`user:${bobId}`]);
    const late = db.savePersonalSteps(bobId, { date: today, steps: 1, capturedAt: new Date().toISOString(), syncedAt: new Date().toISOString() }, tokenHash(code), timeZone).then(() => null, error => error);
    await client.query('UPDATE profiles SET code_seed=$2,code_hash=$3 WHERE user_id=$1', [bobId, 'test-rotation-seed', tokenHash('not-a-valid-secret')]);
    await client.query('COMMIT'); client.release();
    expect(await late).toMatchObject({ status: 401 }); expect((await db.personalActivity([bobId])).find(d => d.date === today)?.steps).toBe(90);
    const current = await asBob('/me'); code = (await current.json()).userCode;
    expect((await simple()).status).toBe(200);
  });
  it('keeps one latest legacy daily total across overlapping challenges, then prefers personal data', async () => {
    const asStranger = (path: string, method = 'GET', body?: unknown) => request(path, method, body, stranger, { 'x-real-ip': '203.0.113.94' });
    const setup = await asStranger('/me', 'PUT', { timeZone: 'UTC' }); const strangerCode = (await setup.json()).userCode;
    const ids: string[] = [];
    for (const [i, steps] of [70, 80].entries()) {
      const c = await asStranger('/challenges', 'POST', { title: 'Historial previo', durationDays: 1, shareConsent: true });
      const id = (await c.json()).challenge.id; ids.push(id);
      const write = await asStranger(`/challenges/${id}/activity`, 'PUT', { days: [{ date: today, steps, workoutSeconds: null, capturedAt: new Date(Date.now() - (20 - i * 10) * 1000).toISOString() }] });
      expect(write.status).toBe(200);
    }
    expect((await (await asStranger('/me/activity')).json()).days).toEqual([expect.objectContaining({ date: today, steps: 80 })]);
    expect((await simple(strangerCode, 90)).status).toBe(200);
    const update = await asStranger(`/challenges/${ids[0]}/activity`, 'PUT', { days: [{ date: today, steps: 500, workoutSeconds: null, capturedAt: new Date().toISOString() }] });
    expect(update.status).toBe(200);
    const history = await (await asStranger('/me/activity')).json();
    expect(history.days).toEqual([expect.objectContaining({ date: today, steps: 90 })]);
    expect(Object.keys(history.days[0]).sort()).toEqual(['capturedAt', 'date', 'steps', 'syncedAt']);
  });
  it('archives legacy history atomically for leavers and all deleted-challenge members without adding duplicate snapshots', async () => {
    const cookies: string[] = [];
    for (const name of ['archiveowner', 'archivepeer']) {
      const r = await request('/auth/sign-up/email', 'POST', { name, email: `${name}@example.test`, password }, '', { 'x-real-ip': '203.0.113.151' });
      expect(r.status).toBe(200); cookies.push(r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '));
    }
    const own = (path: string, method = 'GET', body?: unknown) => request(path, method, body, cookies[0], { 'x-real-ip': '203.0.113.152' });
    const peer = (path: string, method = 'GET', body?: unknown) => request(path, method, body, cookies[1], { 'x-real-ip': '203.0.113.153' });
    await own('/me', 'PUT', { timeZone: 'UTC' }); await peer('/me', 'PUT', { timeZone: 'UTC' });
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const c = await own('/challenges', 'POST', { title: 'Legacy archive', durationDays: 1, shareConsent: true }), id = (await c.json()).challenge.id; ids.push(id);
      const invite = await own(`/challenges/${id}/invites`, 'POST', {}); const { token } = await invite.json();
      expect((await peer('/join', 'POST', { token, shareConsent: true })).status).toBe(200);
      for (const [send, base] of [[own, 60], [peer, 70]] as const) {
        const r = await send(`/challenges/${id}/activity`, 'PUT', { days: [{ date: today, steps: base + i * 20, workoutSeconds: null, capturedAt: new Date(Date.now() - (20 - i * 10) * 1000).toISOString() }] });
        expect(r.status).toBe(200);
      }
    }
    expect((await peer(`/challenges/${ids[1]}/membership`, 'DELETE', {})).status).toBe(200);
    expect((await (await peer('/me/activity')).json()).days).toEqual([expect.objectContaining({ steps: 90 })]);
    for (const id of ids) expect((await own(`/challenges/${id}/membership`, 'DELETE', {})).status).toBe(200);
    expect((await (await own('/me/activity')).json()).days).toEqual([expect.objectContaining({ steps: 80 })]);
    expect((await (await peer('/me/activity')).json()).days).toEqual([expect.objectContaining({ steps: 90 })]);
    const archiveCount = await runtime.pool.query('SELECT count(*)::int AS count FROM legacy_step_archive a JOIN auth_user u ON u.id=a.user_id WHERE u.email IN ($1,$2)', ['archiveowner@example.test', 'archivepeer@example.test']);
    expect(archiveCount.rows[0].count).toBe(2);
    expect((await own('/me/data', 'DELETE', { confirm: 'DELETE' })).status).toBe(200);
    expect((await (await own('/me/activity')).json()).days).toEqual([]);
    expect((await (await peer('/me/activity')).json()).days).toEqual([expect.objectContaining({ steps: 90 })]);
  });
  it('returns the same canonical code to racing profile reads after a server secret change', async () => {
    const svc = new ChallengeService(db, () => new Date(), 'changed-test-secret');
    const identity = (await runtime.pool.query<{ id: string }>("SELECT id FROM auth_user WHERE email='stranger@example.test'")).rows[0]!.id;
    const [a, b] = await Promise.all([svc.handle(identity, 'GET', '/me', {}), svc.handle(identity, 'GET', '/me', {})]) as { userCode: string }[];
    expect(a!.userCode).toBe(b!.userCode);
    expect(await svc.ingestSteps({ userCode: a!.userCode, steps: 90 })).toMatchObject({ accepted: 1 });
    expect(await svc.ingestSteps({ userCode: b!.userCode, steps: 90 })).toMatchObject({ accepted: 1 });
  });
  it('grants new tables to non-owner runtime without DDL and deletes personal history/capability with shared data', async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!); url.username = 'ritmo_limited_test';
    const limited = createRuntime({ ...readConfig(), databaseURL: url.toString(), origin });
    try {
      const rights = (await limited.pool.query("SELECT has_table_privilege(current_user,'personal_steps','INSERT') AS writes,has_table_privilege(current_user,'personal_steps','TRUNCATE') AS truncates")).rows[0];
      expect(rights).toEqual({ writes: true, truncates: false });
      const r = await limited.handler(new Request(`${origin}/api/steps`, { method: 'POST', body: JSON.stringify({ userCode: code, steps: 456 }), headers: { 'x-real-ip': '203.0.113.103' } }));
      expect(r.status, await r.clone().text()).toBe(200);
    } finally { await limited.pool.end(); }
    expect((await asBob('/me/data', 'DELETE', { confirm: 'DELETE' })).status).toBe(200);
    expect(await db.personalActivity([bobId])).toHaveLength(0); expect((await simple()).status).toBe(401);
  });
});
