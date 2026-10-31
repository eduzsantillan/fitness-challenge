import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type HandlerOptions } from '../src/handler.js';
import { MemoryRepository } from '../src/memory-repository.js';
import { ChallengeService, tokenHash } from '../src/service.js';
import type { Challenge } from '../src/model.js';
const origin = 'https://ritmo.example';
let now: Date, db: MemoryRepository, service: ChallengeService;
type Profile = { userId: string; displayName: string; userCode: string; timeZone: string | null };
const profile = (userId = 'alice') => service.handle(userId, 'GET', '/me', {}) as Promise<Profile>;
const setup = async (userId = 'alice', timeZone = 'America/Toronto') => service.handle(userId, 'PUT', '/me', { timeZone, displayName: userId }) as Promise<Profile>;
const create = async (durationDays = 7) => (await service.handle('alice', 'POST', '/challenges', { title: 'El paseo', prize: 'Una cena', durationDays, shareConsent: true }) as { challenge: Challenge }).challenge;
beforeEach(() => { now = new Date('2026-11-01T03:30:00Z'); db = new MemoryRepository(); service = new ChallengeService(db, () => now, 'test-secret'); });
describe('simple personal step capability', () => {
  it('creates a stable private high-entropy code and only exposes it to its own profile', async () => {
    const a = await profile(), again = await profile(), b = await profile('bob');
    expect(a.userCode).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a.userCode).toBe(again.userCode); expect(a.userCode).not.toBe(b.userCode);
    expect(a.timeZone).toBeNull(); expect(await db.stepIdentity(tokenHash(a.userCode))).toEqual({ userId: 'alice', timeZone: null });
    expect(await db.stepIdentity(a.userCode)).toBeUndefined();
    await setup(); const c = await create();
    const group = await service.handle('alice', 'GET', `/challenges/${c.id}`, {});
    expect(JSON.stringify(group)).not.toContain(a.userCode); expect(JSON.stringify(group)).not.toContain('codeSeed');
    expect(JSON.stringify(await service.handle('alice', 'GET', `/challenges/${c.id}/leaderboard`, {}))).not.toContain(a.userCode);
  });
  it('requires a saved valid IANA timezone, no client date or timezone or caller identity', async () => {
    const p = await profile();
    await expect(service.ingestSteps({ userCode: p.userCode, steps: 90 })).rejects.toMatchObject({ status: 409 });
    await expect(service.handle('alice', 'PUT', '/me', { timeZone: 'Mars/Olympus' })).rejects.toMatchObject({ status: 400 });
    await setup();
    for (const extra of [{ date: '2020-01-01' }, { timeZone: 'UTC' }, { userId: 'bob' }, { capturedAt: now.toISOString() }]) await expect(service.ingestSteps({ userCode: p.userCode, steps: 90, ...extra })).rejects.toMatchObject({ status: 400 });
    for (const steps of [-1, 250001, 1.1, '90', null, undefined]) await expect(service.ingestSteps({ userCode: p.userCode, steps })).rejects.toMatchObject({ status: 400 });
    await expect(service.ingestSteps({ userCode: 'alice', steps: 90 })).rejects.toMatchObject({ status: 401 });
  });
  it('uses the server instant in profile timezone, replaces snapshots, stores without a challenge', async () => {
    const p = await setup();
    expect(await service.ingestSteps({ userCode: p.userCode, steps: 90 })).toMatchObject({ accepted: 1, date: '2026-10-31' });
    await service.ingestSteps({ userCode: p.userCode, steps: 90 });
    await service.ingestSteps({ userCode: p.userCode, steps: 100 });
    let history = await service.handle('alice', 'GET', '/me/activity', {}) as { days: { steps: number; date: string }[] };
    expect(history.days).toHaveLength(1); expect(history.days[0]).toMatchObject({ steps: 100, date: '2026-10-31' });
    now = new Date('2026-11-01T05:30:00Z'); // fall-back day; Toronto is still 01:30 EDT.
    await service.ingestSteps({ userCode: p.userCode, steps: 0 });
    now = new Date('2026-11-01T06:30:00Z'); // same 01:30 EST, not a new day.
    await service.ingestSteps({ userCode: p.userCode, steps: 10 });
    history = await service.handle('alice', 'GET', '/me/activity', {}) as typeof history;
    expect(history.days).toHaveLength(2); expect(history.days[1]).toMatchObject({ steps: 10, date: '2026-11-01' });
    expect((await service.handle('bob', 'GET', '/me/activity', {}) as typeof history).days).toHaveLength(0);
  });
  it('rotates and revokes old codes while preserving personal history', async () => {
    const p = await setup(); await service.ingestSteps({ userCode: p.userCode, steps: 90 });
    const next = await service.handle('alice', 'POST', '/me/code', {}) as Profile;
    expect(next.userCode).not.toBe(p.userCode); expect((await profile()).userCode).toBe(next.userCode);
    await expect(service.ingestSteps({ userCode: p.userCode, steps: 1 })).rejects.toMatchObject({ status: 401 });
    await service.ingestSteps({ userCode: next.userCode, steps: 100 });
    await service.handle('alice', 'DELETE', '/me/data', { confirm: 'DELETE' });
    await expect(service.ingestSteps({ userCode: next.userCode, steps: 1 })).rejects.toMatchObject({ status: 401 });
    expect(await db.personalActivity(['alice'])).toHaveLength(0);
  });
  it('auto-joins creator, calculates inclusive dates, validates prize, overlays global steps without losing workouts', async () => {
    const p = await setup(), c = await create();
    expect(c).toMatchObject({ startDate: '2026-10-31', endDate: '2026-11-06', timeZone: 'America/Toronto', prize: 'Una cena' });
    expect((await db.members(c.id)).map(m => m.userId)).toEqual(['alice']);
    expect((await create(1)).endDate).toBe('2026-10-31');
    for (const durationDays of [0, 32, 1.1, '7']) await expect(service.handle('alice', 'POST', '/challenges', { title: 'Test', durationDays, shareConsent: true })).rejects.toMatchObject({ status: 400 });
    await expect(service.handle('alice', 'POST', '/challenges', { title: 'Test', durationDays: 7, prize: 'x'.repeat(161), shareConsent: true })).rejects.toMatchObject({ status: 400 });
    const legacy = { date: '2026-10-31', steps: 20, workoutSeconds: 100, capturedAt: '2026-11-01T03:00:00Z' };
    await service.handle('alice', 'PUT', `/challenges/${c.id}/activity`, { days: [legacy] });
    await service.ingestSteps({ userCode: p.userCode, steps: 90 });
    const second = await create();
    for (const id of [c.id, second.id]) {
      const board = await service.handle('alice', 'GET', `/challenges/${id}/leaderboard`, {}) as { rows: { steps: number; workoutSeconds: number | null }[] };
      expect(board.rows[0]?.steps).toBe(90); expect(board.rows[0]?.workoutSeconds).toBe(id === c.id ? 100 : null);
    }
  });
  it('retains canonical legacy history from overlapping challenges and lets the personal feed override it', async () => {
    const p = await setup(), a = await create(), b = await create();
    const day = { date: '2026-10-31', steps: 70, workoutSeconds: null, capturedAt: '2026-11-01T02:00:00Z' };
    await service.handle('alice', 'PUT', `/challenges/${a.id}/activity`, { days: [day] });
    await service.handle('alice', 'PUT', `/challenges/${b.id}/activity`, { days: [{ ...day, steps: 80, capturedAt: '2026-11-01T03:00:00Z' }] });
    let history = await service.handle('alice', 'GET', '/me/activity', {}) as { days: { date: string; steps: number }[] };
    expect(history.days).toEqual([expect.objectContaining({ date: '2026-10-31', steps: 80 })]);
    await service.ingestSteps({ userCode: p.userCode, steps: 90 });
    // Legacy rows are only fallback, not competing copies of the personal feed.
    await service.handle('alice', 'PUT', `/challenges/${b.id}/activity`, { days: [{ ...day, steps: 500, capturedAt: now.toISOString() }] });
    history = await service.handle('alice', 'GET', '/me/activity', {}) as typeof history;
    expect(history.days).toEqual([expect.objectContaining({ date: '2026-10-31', steps: 90 })]);
    expect(JSON.stringify(history)).not.toContain('userId');
    expect((await service.handle('bob', 'GET', '/me/activity', {}) as typeof history).days).toEqual([]);
    for (const c of [a, b]) await service.handle('alice', 'DELETE', `/challenges/${c.id}/membership`, {});
    expect((await service.handle('alice', 'GET', '/me/activity', {}) as typeof history).days).toEqual([expect.objectContaining({ steps: 90 })]);
    await service.handle('alice', 'DELETE', '/me/data', { confirm: 'DELETE' });
    expect((await service.handle('alice', 'GET', '/me/activity', {}) as typeof history).days).toEqual([]);
  });
  it('preserves legacy history for a departing member and every member of a deleted challenge', async () => {
    await setup(); await setup('bob'); const a = await create(), b = await create();
    for (const c of [a, b]) {
      const { token } = await service.handle('alice', 'POST', `/challenges/${c.id}/invites`, {}) as { token: string };
      await service.handle('bob', 'POST', '/join', { token, shareConsent: true });
      for (const [userId, steps] of [['alice', c.id === a.id ? 60 : 80], ['bob', c.id === a.id ? 70 : 90]] as const) {
        await service.handle(userId, 'PUT', `/challenges/${c.id}/activity`, { days: [{ date: '2026-10-31', steps, workoutSeconds: null, capturedAt: c.id === a.id ? '2026-11-01T02:00:00Z' : '2026-11-01T03:00:00Z' }] });
      }
    }
    const history = async (id: string) => (await service.handle(id, 'GET', '/me/activity', {}) as { days: { steps: number }[] }).days;
    await service.handle('bob', 'DELETE', `/challenges/${b.id}/membership`, {});
    expect(await history('bob')).toEqual([expect.objectContaining({ steps: 90 })]);
    await service.handle('alice', 'DELETE', `/challenges/${a.id}/membership`, {});
    await service.handle('alice', 'DELETE', `/challenges/${b.id}/membership`, {});
    expect(await db.challenges('alice')).toHaveLength(0); expect(await db.challenges('bob')).toHaveLength(0);
    expect(await history('alice')).toEqual([expect.objectContaining({ steps: 80 })]);
    expect(await history('bob')).toEqual([expect.objectContaining({ steps: 90 })]);
    await service.handle('alice', 'DELETE', '/me/data', { confirm: 'DELETE' });
    expect(await history('alice')).toEqual([]); expect(await history('bob')).toHaveLength(1);
  });
  it('repairs an obsolete derivation once when concurrent detached profile reads race after a secret rotation', async () => {
    class DetachedRepository extends MemoryRepository {
      override async ensurePrivateProfile(userId: string, seed: string, hash: string) { return structuredClone(await super.ensurePrivateProfile(userId, seed, hash)); }
    }
    const detached = new DetachedRepository(), old = new ChallengeService(detached, () => now, 'old-secret');
    const original = await old.handle('alice', 'PUT', '/me', { timeZone: 'UTC' }) as Profile;
    const changed = new ChallengeService(detached, () => now, 'new-secret');
    const reads = await Promise.all([changed.handle('alice', 'GET', '/me', {}), changed.handle('alice', 'GET', '/me', {})]) as Profile[];
    expect(reads[0]!.userCode).toBe(reads[1]!.userCode); expect(reads[0]!.userCode).not.toBe(original.userCode);
    for (const p of reads) expect(await changed.ingestSteps({ userCode: p.userCode, steps: 90 })).toMatchObject({ accepted: 1 });
    await expect(changed.ingestSteps({ userCode: original.userCode, steps: 90 })).rejects.toMatchObject({ status: 401 });
  });
  it('uses each participant calendar for membership cutoff across a UTC midnight', async () => {
    now = new Date('2026-10-31T20:00:00Z'); await setup('alice', 'UTC');
    const c = await create(), { token } = await service.handle('alice', 'POST', `/challenges/${c.id}/invites`, {}) as { token: string };
    now = new Date('2026-11-01T02:00:00Z');
    const bob = await setup('bob', 'America/Los_Angeles'); await service.handle('bob', 'POST', '/join', { token, shareConsent: true });
    expect(await service.ingestSteps({ userCode: bob.userCode, steps: 123 })).toMatchObject({ date: '2026-10-31' });
    const board = await service.handle('alice', 'GET', `/challenges/${c.id}/leaderboard`, {}) as { rows: { userId: string; steps: number | null }[] };
    expect(board.rows.find(r => r.userId === 'bob')?.steps).toBe(123);
    expect(JSON.stringify(board)).not.toContain('America/Los_Angeles');
  });
  it('previews invite without leaking capability or activity; only members see board', async () => {
    await setup(); const c = await create();
    const { token } = await service.handle('alice', 'POST', `/challenges/${c.id}/invites`, {}) as { token: string };
    const preview = await service.handle('bob', 'GET', `/invites/${token}`, {});
    expect(preview).toMatchObject({ challenge: { title: 'El paseo', prize: 'Una cena' }, creator: { displayName: 'alice' }, members: [{ displayName: 'alice' }] });
    expect(JSON.stringify(preview)).not.toContain('userCode'); expect(JSON.stringify(preview)).not.toContain('steps');
    await expect(service.handle('bob', 'GET', `/challenges/${c.id}/leaderboard`, {})).rejects.toMatchObject({ status: 403 });
    await setup('bob'); await service.handle('bob', 'POST', '/join', { token, shareConsent: true });
    expect(await db.members(c.id)).toHaveLength(2);
    now = new Date('2026-12-01T00:00:00Z'); await expect(service.previewInvite(token)).rejects.toMatchObject({ status: 404 });
  });
});
describe('simple endpoint HTTP boundary', () => {
  async function fixture() {
    const p = await setup();
    const options: HandlerOptions = { origin, auth: vi.fn(), user: vi.fn(async () => null), limit: vi.fn(async () => ({ allowed: true, retryAfter: null })) };
    const handler = createHandler(service, options);
    const post = (body: unknown, headers: HeadersInit = {}) => handler(new Request(`${origin}/api/steps`, { method: 'POST', headers, body: JSON.stringify(body) }));
    return { p, options, handler, post };
  }
  it('does not need Authorization, cookies, content-type header or browser Origin and does not consume Authorization', async () => {
    const { p, options, post } = await fixture();
    const response = await post({ userCode: p.userCode, steps: 90 }, { Authorization: 'Bearer unrelated-ignored-token' });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ accepted: 1 });
    expect(options.user).not.toHaveBeenCalled(); expect(options.auth).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect((await post({ steps: 90 }, { Authorization: `Bearer ${p.userCode}` })).status).toBe(401);
  });
  it('retains authenticated profile boundaries and bounds plain JSON requests', async () => {
    const { p, handler, post } = await fixture();
    expect((await handler(new Request(`${origin}/api/me/activity`))).status).toBe(401);
    expect((await handler(new Request(`${origin}/api/steps`, { method: 'POST', body: '{bad' }))).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post({ userCode: p.userCode, steps: 90, padding: 'x'.repeat(2000) })).status).toBe(413);
    expect((await post({ userCode: p.userCode, steps: 90, date: '2026-10-31' })).status).toBe(400);
  });
  it('uses IP and hashed-code limits and returns retry headers', async () => {
    const { p, options, post } = await fixture();
    options.limit = vi.fn(async key => ({ allowed: !key.startsWith('steps:'), retryAfter: 42 }));
    const r = await post({ userCode: p.userCode, steps: 90 }, { 'x-real-ip': '203.0.113.3' });
    expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe('42');
    expect(options.limit).toHaveBeenCalledWith('ip:203.0.113.3', expect.anything());
    expect(options.limit).toHaveBeenCalledWith(`steps:${tokenHash(p.userCode)}`, expect.anything());
    expect(JSON.stringify(vi.mocked(options.limit).mock.calls)).not.toContain(p.userCode);
  });
});
