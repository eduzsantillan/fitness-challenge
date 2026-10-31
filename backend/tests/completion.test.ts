import { beforeEach, describe, expect, it } from 'vitest';
import { boardRows, closingInstant, finalizeResult, isClosed, redactResult } from '../src/completion.js';
import { ChallengeService } from '../src/service.js';
import { MemoryRepository } from '../src/memory-repository.js';
import type { BoardRow, Challenge, Leaderboard } from '../src/model.js';
const challenge: Challenge = { id: 'week', title: 'El brunch', ownerId: 'alice', startDate: '2026-10-25', endDate: '2026-10-31', timeZone: 'America/Toronto', createdAt: '2026-10-25T13:00:00Z', prize: 'Un brunch', prizeRule: 'others' };
const row = (userId: string, steps: number | null): BoardRow => ({ userId, displayName: userId, steps, days: [], workoutSeconds: null });
describe('server-authoritative challenge closing', () => {
  it('includes the last day and uses real IANA/DST next-midnight boundaries', () => {
    expect(closingInstant(challenge)).toBe('2026-11-01T04:00:00.000Z');
    expect(closingInstant({ endDate: '2026-11-01', timeZone: 'America/Toronto' })).toBe('2026-11-02T05:00:00.000Z');
    expect(closingInstant({ endDate: '2026-03-08', timeZone: 'America/Toronto' })).toBe('2026-03-09T04:00:00.000Z');
    expect(isClosed(challenge, new Date('2026-11-01T03:59:59.999Z'))).toBe(false);
    expect(isClosed(challenge, new Date('2026-11-01T04:00:00Z'))).toBe(true);
  });
  it('assigns a single shared prize by explicit rule, never by default assumption', () => {
    const rows = [row('alice', 9000), row('bob', 8000), row('cam', 7000)];
    expect(finalizeResult(challenge, rows, new Date()).payerUserIds).toEqual(['bob', 'cam']);
    expect(finalizeResult({ ...challenge, prizeRule: 'coordinate' }, rows, new Date()).payerUserIds).toEqual([]);
    expect(finalizeResult({ ...challenge, prizeRule: 'creator' }, rows, new Date()).payerUserIds).toEqual([]);
    expect(finalizeResult({ ...challenge, prizeRule: 'creator' }, [row('alice', 1), row('bob', 2)], new Date()).payerUserIds).toEqual(['alice']);
  });
  it.each([
    [[row('alice', 100), row('bob', 100)], 'tie'],
    [[row('alice', 100), row('bob', null)], 'incomplete'],
    [[row('alice', 0), row('bob', 0)], 'no_data'],
    [[row('alice', 100)], 'solo'],
    [[row('alice', null), row('bob', null)], 'incomplete'],
  ] as const)('keeps special outcomes honest and without automatic payers (%s)', (rows, outcome) => {
    const result = finalizeResult(challenge, [...rows], new Date());
    expect(result.outcome).toBe(outcome); expect(result.payerUserIds).toEqual([]);
    if (outcome !== 'tie') expect(result.winnerUserIds).toEqual([]);
  });
  it('uses the last eligible snapshot before cutoff, not a late higher total', () => {
    const members = [{ userId: 'alice', displayName: 'Alice', joinedAt: '2026-10-25T13:00:00Z', shareConsentAt: '2026-10-25T13:00:00Z' }];
    const snapshots = [100, 200, 5000].map((steps, i) => ({ userId: 'alice', date: '2026-10-31', steps, timeZone: 'America/Toronto', capturedAt: `2026-11-01T0${i + 2}:00:00Z`, syncedAt: `2026-11-01T0${i + 2}:00:00Z` }));
    expect(boardRows(challenge, members, [], snapshots, closingInstant(challenge))[0]!.steps).toBe(200);
  });
  it('redacts a departing winner without crowning the runner-up or retaining their steps', () => {
    const frozen = finalizeResult(challenge, [row('alice', 100), row('bob', 200)], new Date());
    const redacted = redactResult(frozen, 'bob');
    expect(redacted.outcome).toBe('winner'); expect(redacted.winnerUserIds).not.toContain('alice');
    expect(redacted.winnerUserIds[0]).toMatch(/^removed-/);
    expect(redacted.rows.find(r => r.redacted)).toMatchObject({ steps: null, days: [], displayName: 'Participante que salió' });
    expect(JSON.stringify(redacted)).not.toContain('bob');
  });
});

describe('completed challenge service flow', () => {
  let now: Date, db: MemoryRepository, service: ChallengeService;
  beforeEach(() => { now = new Date('2026-10-31T16:00:00Z'); db = new MemoryRepository(); service = new ChallengeService(db, () => now); });
  const send = (service: ChallengeService, userId: string, path: string, method = 'GET', body = {}) => service.handle(userId, method, path, body);
  async function setup() {
    const a = await send(service, 'alice', '/me', 'PUT', { displayName: 'Alice', timeZone: 'America/Toronto' }) as { userCode: string };
    const b = await send(service, 'bob', '/me', 'PUT', { displayName: 'Bob', timeZone: 'America/Los_Angeles' }) as { userCode: string };
    const { challenge: c } = await send(service, 'alice', '/challenges', 'POST', { title: 'El cierre', durationDays: 1, prize: 'Un brunch', prizeRule: 'others', shareConsent: true }) as { challenge: Challenge };
    const { token } = await send(service, 'alice', `/challenges/${c.id}/invites`, 'POST') as { token: string };
    await send(service, 'bob', '/join', 'POST', { token, shareConsent: true });
    await service.ingestSteps({ userCode: a.userCode, steps: 200 }); await service.ingestSteps({ userCode: b.userCode, steps: 100 });
    return { c, a, b, token };
  }
  it('freezes received totals despite later profile syncs and authorizes receipt only for winner', async () => {
    const { c, b } = await setup(), path = `/challenges/${c.id}`;
    expect((await send(service, 'alice', `${path}/leaderboard`) as Leaderboard).result).toBeNull();
    await expect(send(service, 'alice', `${path}/prize-receipt`, 'POST')).rejects.toMatchObject({ status: 409 });
    now = new Date('2026-11-01T04:30:00Z'); // Toronto closed; Los Angeles is still on October31.
    await service.ingestSteps({ userCode: b.userCode, steps: 5000 });
    const closed = await send(service, 'alice', `${path}/leaderboard`) as Leaderboard;
    expect(closed.result).toMatchObject({ outcome: 'winner', winnerUserIds: ['alice'], payerUserIds: ['bob'] });
    expect(closed.rows.find(r => r.userId === 'bob')!.steps).toBe(100);
    await expect(send(service, 'bob', `${path}/prize-receipt`, 'POST')).rejects.toMatchObject({ status: 403 });
    const first = await send(service, 'alice', `${path}/prize-receipt`, 'POST');
    now = new Date('2026-11-02T12:00:00Z');
    expect(await send(service, 'alice', `${path}/prize-receipt`, 'POST')).toEqual(first);
  });
  it('blocks late invitations, new joins and legacy writes, but allows private result reads', async () => {
    const { c, token } = await setup(), path = `/challenges/${c.id}`;
    now = new Date('2026-11-01T04:00:00Z');
    await expect(send(service, 'alice', `${path}/invites`, 'POST')).rejects.toMatchObject({ status: 409 });
    await expect(send(service, 'cam', '/join', 'POST', { token, shareConsent: true })).rejects.toMatchObject({ status: 409 });
    await expect(send(service, 'alice', `${path}/activity`, 'PUT', { days: [] })).rejects.toMatchObject({ status: 409 });
    await expect(send(service, 'cam', `${path}/leaderboard`)).rejects.toMatchObject({ status: 403 });
    expect((await send(service, 'bob', `${path}/leaderboard`) as Leaderboard).result?.outcome).toBe('winner');
  });
});
