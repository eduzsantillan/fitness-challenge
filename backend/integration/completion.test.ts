// Only run by scripts/test-postgres.mjs against its disposable loopback cluster.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, readConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { PostgresRepository } from '../src/postgres-repository.js';
import { closingInstant } from '../src/completion.js';
import type { Challenge, Member, PrizeRule } from '../src/model.js';
const pool = createPool(readConfig()), db = new PostgresRepository(pool);
const now = () => new Date();
const end = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const at = `${end}T12:00:00.000Z`;
const late = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000 + 1000).toISOString();
const users: string[] = [];
beforeAll(async () => { await migrate(pool); });
afterAll(async () => { await pool.query('DELETE FROM auth_user WHERE id=ANY($1::text[])', [users]); await pool.end(); });
async function fixture(steps: (number | null)[] = [9000, 8000], rule: PrizeRule = 'others') {
  const members: Member[] = [];
  for (const [index, value] of steps.entries()) {
    const userId = `close-${randomUUID()}`; users.push(userId);
    await pool.query('INSERT INTO auth_user(id,name,email) VALUES($1,$2,$3)', [userId, index ? 'Alex' : 'María', `${userId}@example.test`]);
    members.push({ userId, displayName: index ? 'Alex' : 'María', joinedAt: `${end}T00:00:00Z`, shareConsentAt: `${end}T00:00:00Z` });
    if (value !== null) await pool.query('INSERT INTO personal_step_history(user_id,date,steps,captured_at,synced_at,time_zone) VALUES($1,$2,$3,$4,$4,$5)', [userId, end, value, at, 'UTC']);
  }
  const c: Challenge = { id: randomUUID(), title: 'Brunch de cierre', ownerId: members[0]!.userId, startDate: end, endDate: end, timeZone: 'UTC', createdAt: `${end}T00:00:00Z`, prize: 'Un brunch', prizeRule: rule };
  await db.createChallenge(c, members[0]!);
  for (const member of members.slice(1)) await pool.query('INSERT INTO memberships VALUES($1,$2,$3,$4)', [c.id, member.userId, member.joinedAt, member.shareConsentAt]);
  return { c, members, owner: members[0]!.userId, peer: members[1]?.userId! };
}
describe('PostgreSQL immutable challenge results', () => {
  it('chooses the last pre-cutoff version and stays frozen after late writes or name edits', async () => {
    const f = await fixture();
    await pool.query('INSERT INTO personal_step_history(user_id,date,steps,captured_at,synced_at,time_zone) VALUES($1,$2,250000,$3,$3,$4)', [f.peer, end, late, 'America/Los_Angeles']);
    const board = await db.leaderboard(f.c.id, f.owner, now());
    expect(board.result).toMatchObject({ outcome: 'winner', winnerUserIds: [f.owner], payerUserIds: [f.peer], closedAt: closingInstant(f.c) });
    expect(board.rows.find(row => row.userId === f.owner)?.steps).toBe(9000);
    expect(board.rows.find(row => row.userId === f.peer)?.steps).toBe(8000);
    await pool.query('UPDATE auth_user SET name=$2 WHERE id=$1', [f.peer, 'No cambia el resultado']);
    await pool.query('INSERT INTO personal_step_history(user_id,date,steps,captured_at,synced_at,time_zone) VALUES($1,$2,249999,$3,$3,$4)', [f.peer, end, now().toISOString(), 'UTC']);
    expect(await db.leaderboard(f.c.id, f.peer, now())).toEqual(board);
  });
  it('allows only the actual winning member to confirm receipt, idempotently under concurrency', async () => {
    const f = await fixture();
    await expect(db.receivePrize(f.c.id, f.peer, now())).rejects.toMatchObject({ status: 403 });
    await expect(db.receivePrize(f.c.id, 'not-a-member', now())).rejects.toMatchObject({ status: 403 });
    const [a, b] = await Promise.all([db.receivePrize(f.c.id, f.owner, now()), db.receivePrize(f.c.id, f.owner, now())]);
    expect(a.receivedBy).toBe(f.owner); expect(a.receivedAt).toBeTruthy(); expect(b).toEqual(a);
    expect((await db.leaderboard(f.c.id, f.peer, now())).result?.receivedAt).toBe(a.receivedAt);
  });
  it.each([
    [[12, 12], 'tie'], [[12, null], 'incomplete'], [[0, 0], 'no_data'], [[12], 'solo'],
  ] as const)('does not assign an individual prize to special outcomes (%s)', async (steps, outcome) => {
    const f = await fixture([...steps]);
    const result = (await db.leaderboard(f.c.id, f.owner, now())).result!;
    expect(result.outcome).toBe(outcome); expect(result.payerUserIds).toEqual([]);
    await expect(db.receivePrize(f.c.id, f.owner, now())).rejects.toMatchObject({ status: 403 });
  });
  it('does not invent debt for old/default coordinate rules or when creator wins their own prize', async () => {
    for (const rule of ['coordinate', 'creator'] as const) {
      const f = await fixture([12, 10], rule);
      expect((await db.leaderboard(f.c.id, f.owner, now())).result?.payerUserIds).toEqual([]);
    }
  });
  it('closes legacy writes/invitations/new joins even before anybody opens the result', async () => {
    const f = await fixture();
    await expect(db.saveInvite('closed-test-invite', { challengeId: f.c.id, expiresAt: now().getTime() / 1000 + 1000 })).rejects.toMatchObject({ status: 409 });
    await pool.query('INSERT INTO invitations VALUES($1,$2,$3)', ['closed-test-invite', f.c.id, Math.floor(now().getTime() / 1000) + 1000]);
    await expect(db.join('closed-test-invite', { ...f.members[0]!, userId: 'new-person' }, Math.floor(now().getTime() / 1000))).rejects.toMatchObject({ status: 409 });
    await expect(db.saveActivity(f.c.id, f.owner, [{ date: end, steps: 100000, workoutSeconds: null, capturedAt: at, syncedAt: at }])).rejects.toMatchObject({ status: 409 });
  });
  it('redacts a departed winner without reassigning first place or keeping their health data', async () => {
    const f = await fixture([10, 20]);
    await db.leaderboard(f.c.id, f.owner, now());
    await db.leave(f.c.id, f.peer);
    const board = await db.leaderboard(f.c.id, f.owner, now());
    expect(board.result).toMatchObject({ outcome: 'winner', hasRedactions: true });
    expect(board.result!.winnerUserIds).not.toContain(f.owner);
    expect(JSON.stringify(board)).not.toContain(f.peer); expect(JSON.stringify(board)).not.toContain('Alex');
    expect(board.rows.find(r => r.redacted)).toMatchObject({ steps: null, days: [] });
    await expect(db.receivePrize(f.c.id, f.owner, now())).rejects.toMatchObject({ status: 403 });
    await expect(db.leaderboard(f.c.id, f.peer, now())).rejects.toMatchObject({ status: 403 });
  });
  it('does not infer a winner from an unreconstructable pre-migration overwritten day', async () => {
    const f = await fixture([9000, 8000]);
    await pool.query('DELETE FROM personal_step_history WHERE user_id=$1', [f.peer]);
    await pool.query('INSERT INTO personal_steps(user_id,date,steps,captured_at,synced_at) VALUES($1,$2,25000,$3,$3)', [f.peer, end, late]);
    const board = await db.leaderboard(f.c.id, f.owner, now());
    expect(board.result).toMatchObject({ outcome: 'incomplete', hasMissingData: true, winnerUserIds: [], payerUserIds: [] });
  });
});
