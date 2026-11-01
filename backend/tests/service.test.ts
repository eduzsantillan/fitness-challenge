import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/memory-repository.js';
import { ChallengeService, tokenHash } from '../src/service.js';

let db: MemoryRepository, service: ChallengeService;
const now = new Date('2026-10-30T18:00:00Z');
const input = { title: 'Una semana en movimiento', startDate: '2026-10-26', endDate: '2026-11-01', timeZone: 'America/Toronto', shareConsent: true };
const day = { date: '2026-10-30', steps: 7500, workoutSeconds: 1800, capturedAt: now.toISOString() };
async function create() { return (await service.handle('alice', 'POST', '/challenges', input) as { challenge: { id: string } }).challenge.id; }
beforeEach(() => { db = new MemoryRepository(); service = new ChallengeService(db, () => now); });
describe('private challenges', () => {
  it('updates the visible name in existing memberships', async () => {
    const id = await create(); await service.handle('alice', 'PUT', '/me', { displayName: 'Nuevo nombre' });
    expect((await db.members(id))[0]?.displayName).toBe('Nuevo nombre');
  });
  it('lists participant names only inside shared challenges and follows profile changes', async () => {
    const id = await create(); await service.handle('alice', 'PUT', '/me', {displayName:'Ana'});
    const list = await db.challenges('alice'); expect(list[0]?.participants).toEqual([{displayName:'Ana'}]);
    expect(await db.challenges('stranger')).toEqual([]);
    expect(list[0]?.participants?.[0]).not.toHaveProperty('userId');
    expect((await db.challenge(id))?.participants).toBeUndefined();
  });
  it('requires explicit sharing consent', async () => { await expect(service.handle('alice', 'POST', '/challenges', { ...input, shareConsent: false })).rejects.toMatchObject({ status: 400 }); });
  it('rejects impossible dates and zones', async () => {
    for (const change of [{ startDate: '2026-99-99' }, { endDate: '2026-02-30' }, { timeZone: 'Mars/Olympus' }]) await expect(service.handle('alice', 'POST', '/challenges', { ...input, ...change })).rejects.toMatchObject({ status: 400 });
  });
  it('does not let a stranger read or write group data', async () => {
    const id = await create();
    for (const [method, path] of [['GET', 'leaderboard'], ['PUT', 'activity'], ['POST', 'invites']]) await expect(service.handle('bob', method!, `/challenges/${id}/${path}`, { days: [day] })).rejects.toMatchObject({ status: 403 });
  });
  it('joins through an expiring hashed invitation, with consent', async () => {
    const id = await create();
    const { token } = await service.handle('alice', 'POST', `/challenges/${id}/invites`, {}) as { token: string };
    expect(await db.invite(token)).toBeUndefined(); expect(await db.invite(tokenHash(token))).toBeDefined();
    await expect(service.handle('bob', 'POST', '/join', { token })).rejects.toMatchObject({ status: 400 });
    await service.handle('bob', 'POST', '/join', { token, shareConsent: true });
    await service.handle('bob', 'POST', '/join', { token, shareConsent: true });
    expect(await db.members(id)).toHaveLength(2);
    await expect(service.handle('bob', 'POST', `/challenges/${id}/invites`, {})).rejects.toMatchObject({ status: 403 });
    const future = new ChallengeService(db, () => new Date('2026-11-10T00:00:00Z'));
    await expect(future.handle('charlie', 'POST', '/join', { token, shareConsent: true })).rejects.toMatchObject({ status: 404 });
  });
  it('replaces snapshots instead of adding them and ignores older offline writes', async () => {
    const id = await create(), path = `/challenges/${id}/activity`;
    await service.handle('alice', 'PUT', path, { days: [day] });
    await service.handle('alice', 'PUT', path, { days: [day] });
    await service.handle('alice', 'PUT', path, { days: [{ ...day, steps: 1, capturedAt: '2026-10-30T17:00:00Z' }] });
    expect(await db.activity(id)).toHaveLength(1); expect((await db.activity(id))[0]?.steps).toBe(7500);
    await service.handle('alice', 'PUT', path, { days: [{ ...day, steps: 7000 }] });
    expect((await db.activity(id))[0]?.steps).toBe(7000);
  });
  it('takes identity from authentication, not the payload', async () => {
    const id = await create(); await service.handle('alice', 'PUT', `/challenges/${id}/activity`, { days: [{ ...day, userId: 'bob' }], userId: 'bob' });
    expect((await db.activity(id))[0]?.userId).toBe('alice');
  });
  it('rejects future, invalid, duplicate and out-of-period data', async () => {
    const id = await create();
    for (const days of [[{ ...day, steps: -1 }], [{ ...day, steps: 1.1 }], [{ ...day, workoutSeconds: '50' }], [{ ...day, steps: undefined }], [{ ...day, date: '2026-10-25' }], [{ ...day, date: '2026-10-31' }], [{ ...day, capturedAt: '2026-11-01T00:00:00Z' }], [day, day]]) await expect(service.handle('alice', 'PUT', `/challenges/${id}/activity`, { days })).rejects.toMatchObject({ status: 400 });
  });
  it('keeps no visible data distinct from a measured zero', async () => {
    const id = await create();
    const empty = await service.handle('alice', 'GET', `/challenges/${id}/leaderboard`, {}) as { rows: { steps: number | null; workoutSeconds: number | null }[] };
    expect(empty.rows[0]?.steps).toBeNull();
    await service.handle('alice', 'PUT', `/challenges/${id}/activity`, { days: [{ ...day, steps: 0, workoutSeconds: null }] });
    const result = await service.handle('alice', 'GET', `/challenges/${id}/leaderboard`, {}) as typeof empty;
    expect(result.rows[0]?.steps).toBe(0); expect(result.rows[0]?.workoutSeconds).toBeNull();
  });
});
