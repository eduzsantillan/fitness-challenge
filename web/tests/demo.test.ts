import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoClient, DEMO_USER_CODE } from '../src/demo';
import type { Activity, Board, Challenge, InvitePreview, Profile } from '../src/types';

const now = () => new Date('2026-10-31T17:00:00Z');
const demo = () => new DemoClient(now, 'America/Toronto');
type History = { days: Activity[]; timeZone: string };
const create = (client: DemoClient, body: Record<string, unknown> = {}) => client.request<{ challenge: Challenge }>('/challenges', 'POST', {
  title: 'Un paseo juntos', prize: 'Una cena', durationDays: 7, shareConsent: true, ...body,
});
afterEach(() => vi.restoreAllMocks());

describe('isolated, explicitly fictional demo', () => {
  it('shows two sample prizes and an obvious non-live user code', async () => {
    const client = demo(), profile = await client.request<Profile>('/me');
    expect(profile).toEqual({ userId: 'demo-you', displayName: 'Tú', userCode: DEMO_USER_CODE, timeZone: 'America/Toronto' });
    expect(DEMO_USER_CODE).not.toMatch(/^[A-Za-z0-9_-]{43}$/);
    const list = await client.request<{ challenges: Challenge[] }>('/challenges');
    expect(list.challenges.map(challenge => challenge.prize)).toEqual(['Un brunch para dos', 'Alguien invita los cafés', 'Un brunch y café para dos']);
  });
  it('keeps sample history once per local date and shares it consistently across boards', async () => {
    const client = demo(), history = await client.request<History>('/me/activity');
    expect(history.timeZone).toBe('America/Toronto');
    expect(history.days).toHaveLength(31);
    expect(new Set(history.days.map(day => day.date)).size).toBe(31);
    expect(history.days[0]!.date).toBe('2026-10-01'); expect(history.days.at(-1)!.date).toBe('2026-10-31');
    for (const id of ['demo-week', 'demo-month']) {
      const board = await client.request<Board>(`/challenges/${id}/leaderboard`);
      const expected = history.days.filter(day => day.date >= board.challenge.startDate && day.date <= board.challenge.endDate);
      expect(board.rows[0]!.days).toEqual(expected);
      expect(board.rows[0]!.steps).toBe(expected.reduce((total, day) => total + day.steps!, 0));
      expect(board.rows[0]!.workoutSeconds).toBeNull();
    }
  });
  it('includes an overlapping prior-month week without duplicated history', async () => {
    const client = new DemoClient(() => new Date('2026-10-01T17:00:00Z'), 'America/Toronto');
    const history = await client.request<History>('/me/activity');
    expect(history.days.map(day => day.date)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
    const month = await client.request<Board>('/challenges/demo-month/leaderboard');
    expect(month.rows[0]!.days.map(day => day.date)).toEqual(['2026-10-01']);
  });
  it('never calls a network API, returns defensive copies and has no state shared between instances', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const first = demo();
    const profile = await first.request<Profile>('/me'); profile.displayName = 'Mutated response';
    const history = await first.request<History>('/me/activity'); history.days[0]!.steps = -100;
    expect((await first.request<Profile>('/me')).displayName).toBe('Tú');
    expect((await first.request<History>('/me/activity')).days[0]!.steps).toBeGreaterThan(0);
    await first.request('/me', 'PUT', { displayName: 'Nombre local' });
    expect((await demo().request<Profile>('/me')).displayName).toBe('Tú');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects real code generation and all health ingestion without changing the fake code', async () => {
    const client = demo();
    await expect(client.request('/me/code', 'POST')).rejects.toThrow('no genera códigos reales');
    await expect(client.request('/steps', 'POST', { steps: 90, userCode: DEMO_USER_CODE })).rejects.toThrow('no recibe datos reales');
    await expect(client.request('/shortcuts', 'POST')).rejects.toThrow('no recibe datos reales');
    await expect(client.request('/challenges/demo-week/connection', 'POST')).rejects.toThrow('no genera claves');
    expect((await client.request<Profile>('/me')).userCode).toBe(DEMO_USER_CODE);
  });
});

describe('simplified demo profile and challenges', () => {
  it('allows partial profile edits, keeps history and syncs names across all boards', async () => {
    const client = demo();
    const changed = await client.request<Profile>('/me', 'PUT', { displayName: 'Edu' });
    expect(changed.timeZone).toBe('America/Toronto');
    expect((await client.request<Board>('/challenges/demo-month/leaderboard')).rows[0]!.displayName).toBe('Edu');
    const zone = await client.request<Profile>('/me', 'PUT', { timeZone: 'Europe/Madrid' });
    expect(zone.displayName).toBe('Edu'); expect(zone.timeZone).toBe('Europe/Madrid');
    expect((await client.request<History>('/me/activity')).days).toHaveLength(31);
    await expect(client.request('/me', 'PUT', { displayName: 'Unapplied', timeZone: 'not/a-zone' })).rejects.toThrow('Zona horaria');
    expect((await client.request<Profile>('/me')).displayName).toBe('Edu');
  });
  it('creates a duration-and-prize challenge on the local day and automatically adds its creator once', async () => {
    const client = new DemoClient(() => new Date('2026-11-01T02:00:00Z'), 'America/Toronto');
    const result = await create(client, { prize: '  Un helado  ' });
    expect(result.challenge).toMatchObject({ ownerId: 'demo-you', startDate: '2026-10-31', endDate: '2026-11-06', timeZone: 'America/Toronto', prize: 'Un helado' });
    const board = await client.request<Board>(`/challenges/${result.challenge.id}/leaderboard`);
    expect(board.rows).toHaveLength(1); expect(board.rows[0]!.userId).toBe('demo-you');
    expect(board.rows[0]!.days.map(day => day.date)).toEqual(['2026-10-31']);
    expect(board.rows[0]!.steps).toBe((await client.request<History>('/me/activity')).days.at(-1)!.steps);
  });
  it('supports 1 and 31 inclusive days but rejects invalid duration, prize, name or missing consent', async () => {
    const client = demo();
    expect((await create(client, { durationDays: 1 })).challenge.endDate).toBe('2026-10-31');
    expect((await create(client, { durationDays: 31 })).challenge.endDate).toBe('2026-11-30');
    for (const durationDays of [0, 32, -1, 1.5, '7']) await expect(create(client, { durationDays })).rejects.toThrow('entre 1 y 31');
    await expect(create(client, { prize: 'x'.repeat(161) })).rejects.toThrow('premio');
    await expect(create(client, { title: '' })).rejects.toThrow('Nombre');
    await expect(create(client, { shareConsent: false })).rejects.toThrow('compartir');
  });
  it('retains old explicit dates as an optional compatibility contract', async () => {
    const client = demo();
    const { challenge } = await create(client, { durationDays: undefined, startDate: '2026-10-30', endDate: '2026-11-04', timeZone: 'America/Toronto' });
    expect(challenge.startDate).toBe('2026-10-30'); expect(challenge.endDate).toBe('2026-11-04');
  });
  it('previews a fake invitation without revealing profile codes and joins idempotently', async () => {
    const client = demo();
    const invite = await client.request<{ token: string }>('/challenges/demo-week/invites', 'POST');
    expect(invite.token).toBe('DEMO-demo-week');
    const preview = await client.request<InvitePreview>(`/invites/${invite.token}`);
    expect(preview.challenge.prize).toBe('Un brunch para dos');
    expect(preview.creator).toEqual({ displayName: 'Tú' });
    expect(preview.members).toEqual([{ displayName: 'Tú' }, { displayName: 'Alex' }]);
    expect(JSON.stringify(preview)).not.toContain(DEMO_USER_CODE);
    for (let i = 0; i < 2; i++) await client.request('/join', 'POST', { token: invite.token, shareConsent: true });
    expect((await client.request<Board>('/challenges/demo-week/leaderboard')).rows).toHaveLength(2);
    await expect(client.request('/join', 'POST', { token: invite.token })).rejects.toThrow('compartir');
    await expect(client.request('/invites/real-looking-secret')).rejects.toThrow('enlaces de ejemplo');
    await expect(client.request('/invites/DEMO-not-here')).rejects.toThrow('No se encontró');
  });
  it('updates each daily snapshot once across profile and every overlapping challenge', async () => {
    const client = demo(), newDay = { date: '2026-10-31', steps: 90, workoutSeconds: null };
    for (let i = 0; i < 2; i++) await client.request('/challenges/demo-week/activity', 'PUT', { days: [newDay] });
    const history = await client.request<History>('/me/activity');
    expect(history.days.filter(day => day.date === newDay.date)).toHaveLength(1);
    expect(history.days.at(-1)!.steps).toBe(90);
    for (const id of ['demo-week', 'demo-month']) {
      expect((await client.request<Board>(`/challenges/${id}/leaderboard`)).rows[0]!.days.find(day => day.date === newDay.date)!.steps).toBe(90);
    }
  });
  it('does not partially update history on an invalid batch', async () => {
    const client = demo(), before = await client.request<History>('/me/activity');
    await expect(client.request('/challenges/demo-week/activity', 'PUT', { days: [
      { date: '2026-10-31', steps: 0, workoutSeconds: null }, { date: '2026-11-01', steps: 10, workoutSeconds: null },
    ] })).rejects.toThrow('futura');
    expect(await client.request<History>('/me/activity')).toEqual(before);
  });
  it('requires deletion confirmation and clears only this demo instance', async () => {
    const client = demo();
    await expect(client.request('/me/data', 'DELETE')).rejects.toThrow('Confirma');
    await client.request('/me/data', 'DELETE', { confirm: 'DELETE' });
    expect((await client.request<{ challenges: Challenge[] }>('/challenges')).challenges).toEqual([]);
    expect((await client.request<History>('/me/activity')).days).toEqual([]);
    expect((await demo().request<{ challenges: Challenge[] }>('/challenges')).challenges).toHaveLength(3);
  });
});

 describe('fictional completed challenge', () => {
  it('includes a frozen result and explicit prize agreement, never fake real health ingestion', async () => {
    const client = demo();
    const board = await client.request<Board>('/challenges/demo-finish/leaderboard');
    expect(board.result).toMatchObject({ outcome: 'winner', prizeRule: 'others', receivedAt: null });
    expect(board.rows.every(row => row.steps !== null)).toBe(true);
    const original = structuredClone(board);
    await client.request('/challenges/demo-week/activity', 'PUT', { days: [{ date: '2026-10-30', steps: 250000, workoutSeconds: null }] });
    expect(await client.request<Board>('/challenges/demo-finish/leaderboard')).toEqual(original);
    await expect(client.request('/challenges/demo-finish/invites', 'POST')).rejects.toThrow('ya terminó');
  });
  it('keeps confirmation idempotent and refuses non-winners or open challenges', async () => {
    const client = demo();
    const board = await client.request<Board>('/challenges/demo-finish/leaderboard');
    if (board.result!.winnerUserIds.includes('demo-you')) {
      const first = await client.request('/challenges/demo-finish/prize-receipt', 'POST');
      expect(await client.request('/challenges/demo-finish/prize-receipt', 'POST')).toEqual(first);
    } else await expect(client.request('/challenges/demo-finish/prize-receipt', 'POST')).rejects.toThrow('Solo quien ganó');
    await expect(client.request('/challenges/demo-week/prize-receipt', 'POST')).rejects.toThrow('cuando termina');
  });
});
