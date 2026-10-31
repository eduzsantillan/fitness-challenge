import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { runSimpleSmoke } from './smoke-simple.mjs';
const server = spawn(process.execPath, ['--import', 'tsx', 'backend/local.ts'], { env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local API did not start')), 10000);
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Local API exited: ${code}`)); });
    server.stdout.on('data', data => { const match = /http:\/\/127\.0\.0\.1:\d+/.exec(data.toString()); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    server.stderr.on('data', data => process.stderr.write(data));
  });
  const jars = { alice: '', bob: '' };
  async function request(path, method = 'GET', body, person = 'alice', token) {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { origin: process.env.APP_ORIGIN, cookie: jars[person] ?? '', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookies = response.headers.getSetCookie(); if (cookies.length && person in jars) jars[person] = cookies.map(c => c.split(';')[0]).join('; ');
    return { status: response.status, value: await response.json() };
  }
  for (const person of ['alice', 'bob']) {
    const result = await request('/auth/sign-up/email', 'POST', { name: person, email: `${person}-smoke@example.test`, password: 'Smoke-password-secure-123' }, person); assert.equal(result.status, 200, JSON.stringify(result.value)); assert.ok(jars[person]); assert.equal(result.value.token, undefined);
  }
  const today = new Date().toISOString().slice(0, 10), group = await request('/challenges', 'POST', { title: 'HTTP smoke', startDate: today, endDate: today, timeZone: 'UTC', shareConsent: true });
  assert.equal(group.status, 200); const id = group.value.challenge.id;
  const invite = await request(`/challenges/${id}/invites`, 'POST', {});
  assert.equal((await request('/join', 'POST', { token: invite.value.token, shareConsent: true }, 'bob')).status, 200);
  const connection = await request(`/challenges/${id}/connection`, 'POST', {}), token = connection.value.token;
  const payload = { date: today, steps: 1234, timeZone: 'UTC' };
  assert.equal((await request('/shortcuts', 'POST', payload, 'none', token)).status, 200);
  assert.equal((await request('/shortcuts', 'POST', payload, 'none', token)).status, 200);
  const board = await request(`/challenges/${id}/leaderboard`, 'GET', undefined, 'bob');
  assert.equal(board.value.rows.length, 2); assert.equal(board.value.rows.find(r => r.displayName === 'alice').steps, 1234);
  assert.equal((await request(`/challenges/${id}/leaderboard`, 'GET', undefined, 'none', token)).status, 401);
  assert.equal((await request('/me', 'GET', undefined, 'none', 'local-alice')).status, 401);
  await request(`/challenges/${id}/connection`, 'DELETE', {});
  assert.equal((await request('/shortcuts', 'POST', payload, 'none', token)).status, 401);
  await request('/auth/sign-out', 'POST', {});
  assert.equal((await request('/me')).status, 401);
  await runSimpleSmoke(origin, process.env.APP_ORIGIN);
  console.log('HTTP smoke passed: real registration/cookies, two users, PostgreSQL persistence, scoped ingest, idempotency and revocation.');
} finally { server.kill('SIGTERM'); }
