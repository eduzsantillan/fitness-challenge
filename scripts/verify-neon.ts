// Opt-in integration against the configured Neon database; creates only its own disposable test users.
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { readConfig } from '../backend/src/config.js';
import { createRuntime } from '../backend/src/runtime.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.argv.includes('--allow-test-writes')) { console.error('Usa --allow-test-writes para autorizar cuentas ficticias temporales; no ejecutar como prueba automática.'); process.exit(1); }
const config = readConfig(), url = new URL(config.databaseURL);
if (!url.hostname.endsWith('.neon.tech') || url.pathname !== '/fitness_challenge' || decodeURIComponent(url.username) !== 'fitness_challenge_app') throw new Error('La verificación solo acepta la base fitness_challenge y su usuario limitado.');
const runtime = createRuntime(config), runId = randomUUID(), testPassword = randomBytes(32).toString('base64url');
const emails = [`ritmo-check-${runId}-a@example.test`, `ritmo-check-${runId}-b@example.test`], hashes = new Set<string>();
const consume = runtime.limiter.consume.bind(runtime.limiter);
runtime.limiter.consume = async (key, rule) => { hashes.add(createHmac('sha256', config.secret).update(`ritmo-limit:${key}`).digest('hex')); return consume(key, rule); };
const cookies = new Map<string, string>();
let stage = 'preflight', success = false, cleanup = false;
async function api(path: string, method = 'GET', body?: unknown, user?: string, token?: string) {
  const response = await runtime.handler(new Request(`${config.origin}/api${path}`, { method, headers: { origin: config.origin, 'content-type': 'application/json', 'x-real-ip': '198.51.100.248', cookie: cookies.get(user ?? '') ?? '', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const set = response.headers.getSetCookie(); if (user && set.length) cookies.set(user, set.map(c => c.split(';')[0]).join('; '));
  return response;
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
try {
  const rights = (await runtime.pool.query(`SELECT current_database() AS database, current_user AS role, has_schema_privilege(current_user,'public','CREATE') AS ddl,
    has_table_privilege(current_user,'ritmo_migrations','UPDATE') AS migration_write,
    has_table_privilege(current_user,'auth_user','TRUNCATE') AS truncate_data,
    has_database_privilege(current_user,current_database(),'CREATE') AS create_schema,
    (SELECT count(*)::int FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships,
    (SELECT rolcreatedb OR rolcreaterole OR rolsuper OR rolbypassrls OR rolreplication FROM pg_roles WHERE rolname=current_user) AS admin`)).rows[0];
  check(rights.database === 'fitness_challenge' && !rights.ddl && !rights.migration_write && !rights.admin && !rights.truncate_data && !rights.create_schema && rights.memberships === 0, 'runtime_permissions');
  check((await runtime.pool.query('SELECT 1 FROM auth_user WHERE email=ANY($1::text[])', [emails])).rowCount === 0, 'test_identifier_collision');
  stage = 'registration';
  for (const [index, person] of ['a', 'b'].entries()) {
    const response = await api('/auth/sign-up/email', 'POST', { name: `Verificación temporal ${person.toUpperCase()}`, email: emails[index], password: testPassword }, person);
    check(response.status === 200 && cookies.get(person), 'registration_failed');
    check(/httponly/i.test(response.headers.get('set-cookie') ?? ''), 'cookie_not_httponly');
    const body = await response.json() as Record<string, unknown>; check(!('token' in body), 'token_exposed');
  }
  const today = new Date().toISOString().slice(0, 10);
  stage = 'challenge_and_invite';
  const create = await api('/challenges', 'POST', { title: `Verificación temporal ${runId.slice(0, 8)}`, startDate: today, endDate: today, timeZone: 'UTC', shareConsent: true }, 'a');
  check(create.status === 200, 'challenge_failed'); const id = (await create.json()).challenge.id as string;
  check((await api(`/challenges/${id}/leaderboard`, 'GET', undefined, 'b')).status === 403, 'membership_leak');
  const invite = await api(`/challenges/${id}/invites`, 'POST', {}, 'a'); check(invite.status === 200, 'invite_failed');
  const inviteToken = (await invite.json()).token;
  check((await api('/join', 'POST', { token: inviteToken, shareConsent: true }, 'b')).status === 200, 'join_failed');
  stage = 'manual_and_shortcuts';
  check((await api(`/challenges/${id}/activity`, 'PUT', { days: [{ date: today, steps: 1000, workoutSeconds: 1200, capturedAt: new Date(Date.now() - 2000).toISOString() }] }, 'a')).status === 200, 'manual_failed');
  const connection = await api(`/challenges/${id}/connection`, 'POST', {}, 'a'); check(connection.status === 200, 'connection_failed');
  const token = (await connection.json()).token as string;
  for (let repeat = 0; repeat < 2; repeat++) {
    const ingest = await api('/shortcuts', 'POST', { date: today, steps: 1234, timeZone: 'UTC' }, undefined, token);
    check(ingest.status === 200 && (await ingest.json()).accepted === 1, 'ingest_failed');
  }
  const board = await api(`/challenges/${id}/leaderboard`, 'GET', undefined, 'b'); check(board.status === 200, 'leaderboard_failed');
  const rows = (await board.json()).rows as { steps: number | null; workoutSeconds: number | null; days: unknown[] }[];
  check(rows.length === 2 && rows.some(r => r.steps === 1234 && r.workoutSeconds === 1200 && r.days.length === 1), 'snapshot_or_workout_failed');
  check((await api(`/challenges/${id}/leaderboard`, 'GET', undefined, undefined, token)).status === 401, 'ingest_scope_leak');
  stage = 'persistence';
  const second = createRuntime(config);
  try {
    const persisted = await second.handler(new Request(`${config.origin}/api/challenges/${id}/leaderboard`, { headers: { cookie: cookies.get('b')!, 'x-real-ip': '198.51.100.248' } }));
    check(persisted.status === 200 && (await persisted.json()).rows.some((r: { steps: number }) => r.steps === 1234), 'database_persistence_failed');
  } finally { await second.pool.end(); }
  stage = 'revocation_and_logout';
  check((await api(`/challenges/${id}/connection`, 'DELETE', {}, 'a')).status === 200, 'revoke_failed');
  check((await api('/shortcuts', 'POST', { date: today, steps: 1234, timeZone: 'UTC' }, undefined, token)).status === 401, 'revoked_key_accepted');
  const previousCookie = cookies.get('a')!;
  check((await api('/auth/sign-out', 'POST', {}, 'a')).status === 200, 'logout_failed'); cookies.set('a', previousCookie);
  check((await api('/me', 'GET', undefined, 'a')).status === 401, 'revoked_session_accepted');
  success = true;
} catch (error) {
  console.error(JSON.stringify({ verified: false, stage, check: error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'DATABASE_OR_API_ERROR' })); process.exitCode = 1;
} finally {
  try {
    // Only delete the exact generated fixture identifiers. Never truncate tables or touch real accounts.
    await runtime.pool.query('DELETE FROM auth_user WHERE email=ANY($1::text[])', [emails]);
    await runtime.pool.query('DELETE FROM request_limits WHERE key=ANY($1::text[])', [[...hashes]]);
    cleanup = (await runtime.pool.query('SELECT 1 FROM auth_user WHERE email=ANY($1::text[])', [emails])).rowCount === 0;
    check(cleanup, 'fixture_cleanup_failed');
  } catch { console.error('No se pudo confirmar la limpieza de las cuentas ficticias de esta verificación.'); process.exitCode = 1; }
  await runtime.pool.end();
}
if (success && cleanup) {
  const report = { checkedAt: new Date().toISOString(), database: 'fitness_challenge', provider: 'Neon', runtimeRole: 'fitness_challenge_app', runtimeHasDDL: false,
    checks: ['registration', 'httpOnly_cookie_sessions', 'private_membership', 'invitations', 'manual_activity', 'shortcut_ingest', 'daily_snapshot_idempotency', 'preserve_workout', 'persistence_in_new_runtime', 'credential_revocation', 'logout_revokes_session'],
    temporaryTestAccountsRemoved: true, deployedToVercel: false, iPhoneHealthReadValidated: false };
  await writeFile('docs/neon-verification.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ verified: true, database: 'fitness_challenge', checks: report.checks.length, temporaryTestAccountsRemoved: true, secretsPrinted: false }));
}
