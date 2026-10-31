import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../src/memory-repository.js';
import { ChallengeService, tokenHash } from '../src/service.js';
const now = new Date('2026-10-30T18:00:00Z');
let db: MemoryRepository, service: ChallengeService, id: string;
const activity = { date: '2026-10-30', steps: 8000, timeZone: 'America/Toronto' };
async function connect() { return service.handle('alice', 'POST', `/challenges/${id}/connection`, {}) as Promise<{ token: string }>; }
beforeEach(async () => {
  db = new MemoryRepository(); service = new ChallengeService(db, () => now);
  const result = await service.handle('alice', 'POST', '/challenges', { title: 'Reto', startDate: '2026-10-26', endDate: '2026-11-01', timeZone: activity.timeZone, shareConsent: true }) as { challenge: { id: string } }; id = result.challenge.id;
});
describe('Shortcuts scoped credentials', () => {
  it('stores only a hash and ingests as the bound user, never a caller-supplied identity', async () => {
    const { token } = await connect();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(await db.connection(token)).toBeUndefined(); expect(await db.connection(tokenHash(token))).toBeDefined();
    await service.ingest(token, { ...activity, userId: 'bob', challengeId: 'wrong' });
    expect((await db.activity(id))[0]).toMatchObject({ userId: 'alice', steps: 8000, workoutSeconds: null, source: 'shortcuts' });
  });
  it('requires membership to create, inspect, or revoke a connection', async () => {
    for (const method of ['POST', 'GET', 'DELETE']) await expect(service.handle('bob', method, `/challenges/${id}/connection`, {})).rejects.toMatchObject({ status: 403 });
  });
  it('rejects guessed tokens, mismatched zones and wrong metric types', async () => {
    const { token } = await connect();
    await expect(service.ingest('guessed', activity)).rejects.toMatchObject({ status: 401 });
    await expect(service.ingest('x'.repeat(43), activity)).rejects.toMatchObject({ status: 401 });
    await expect(service.ingest(token, { ...activity, timeZone: 'UTC' })).rejects.toMatchObject({ status: 400 });
    await expect(service.ingest(token, { ...activity, steps: '8000' })).rejects.toMatchObject({ status: 400 });
  });
  it('rotates, revokes, and expires credentials independently of login', async () => {
    const first = await connect(), second = await connect();
    await expect(service.ingest(first.token, activity)).rejects.toMatchObject({ status: 401 });
    await service.ingest(second.token, activity);
    const future = new ChallengeService(db, () => new Date('2026-12-01T00:00:00Z'));
    await expect(future.ingest(second.token, activity)).rejects.toMatchObject({ status: 401 });
    await service.handle('alice', 'DELETE', `/challenges/${id}/connection`, {});
    await expect(service.ingest(second.token, activity)).rejects.toMatchObject({ status: 401 });
  });
  it('preserves manually recorded workout duration when only steps arrive', async () => {
    await service.handle('alice', 'PUT', `/challenges/${id}/activity`, { days: [{ ...activity, workoutSeconds: 2700, capturedAt: now.toISOString() }] });
    const { token } = await connect(); await service.ingest(token, { ...activity, steps: 9100 });
    expect((await db.activity(id))[0]).toMatchObject({ steps: 9100, workoutSeconds: 2700, source: 'mixed' });
  });
  it('clears activity and revokes the connection together', async () => {
    const { token } = await connect(); await service.ingest(token, activity);
    await service.handle('alice', 'DELETE', `/challenges/${id}/activity`, {});
    expect(await db.activity(id)).toHaveLength(0);
    await expect(service.ingest(token, activity)).rejects.toMatchObject({ status: 401 });
  });
  it('removes a departing member from rankings and future writes', async () => {
    const invite = await service.handle('alice', 'POST', `/challenges/${id}/invites`, {}) as { token: string };
    await service.handle('bob', 'POST', '/join', { token: invite.token, shareConsent: true });
    await service.handle('bob', 'DELETE', `/challenges/${id}/membership`, {});
    await expect(service.handle('bob', 'GET', `/challenges/${id}/leaderboard`, {})).rejects.toMatchObject({ status: 403 });
    expect(await db.members(id)).toHaveLength(1);
  });
  it('deletes owned challenges, invitations and connections when app data is erased', async () => {
    const { token } = await connect(); await service.ingest(token, activity);
    const invite = await service.handle('alice', 'POST', `/challenges/${id}/invites`, {}) as { token: string };
    await expect(service.handle('alice', 'DELETE', '/me/data', {})).rejects.toMatchObject({ status: 400 });
    await service.handle('alice', 'DELETE', '/me/data', { confirm: 'DELETE' });
    expect(await db.challenge(id)).toBeUndefined(); expect(await db.activity(id)).toHaveLength(0);
    expect(await db.invite(tokenHash(invite.token))).toBeUndefined(); await expect(service.ingest(token, activity)).rejects.toMatchObject({ status: 401 });
  });
});
