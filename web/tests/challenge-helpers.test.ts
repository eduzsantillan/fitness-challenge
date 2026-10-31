import { describe, expect, it } from 'vitest';
import {
  getChallengeStatus, getMotivation, groupPersonalSteps, MOTIVATION_PHRASES, summarizePersonalSteps,
  type MotivationInput, type MotivationRow, type PersonalStepDay,
} from '../src/challenge-helpers';

const row = (userId: string, steps: number | null): MotivationRow => ({ userId, displayName: userId, steps });
const base: MotivationInput = {
  challengeId: 'reto-juntos', prize: 'una cena', rows: [row('me', 200), row('friend', 100)],
  userId: 'me', today: '2026-10-10', startDate: '2026-10-01', endDate: '2026-10-31',
};
const motivate = (patch: Partial<MotivationInput> = {}) => getMotivation({ ...base, ...patch });
const day = (date: string, steps: number | null): PersonalStepDay => ({ date, steps });

describe('challenge status in supplied local calendar dates', () => {
  it('includes both first and final calendar days in an active challenge', () => {
    expect(getChallengeStatus('2026-10-01', '2026-10-31', '2026-09-30')).toBe('upcoming');
    expect(getChallengeStatus('2026-10-01', '2026-10-31', '2026-10-01')).toBe('active');
    expect(getChallengeStatus('2026-10-01', '2026-10-31', '2026-10-31')).toBe('active');
    expect(getChallengeStatus('2026-10-01', '2026-10-31', '2026-11-01')).toBe('finished');
  });
  it('rejects malformed and impossible dates rather than silently normalizing them', () => {
    for (const date of ['2026-02-29', '2026-13-01', '2026-10-1', 'not-a-date', '2026-10-01T00:00:00Z']) {
      expect(() => getChallengeStatus('2026-10-01', '2026-10-31', date)).toThrow(RangeError);
    }
    expect(() => getChallengeStatus('2026-11-01', '2026-10-01', '2026-10-01')).toThrow(RangeError);
    expect(getChallengeStatus('2028-02-29', '2028-02-29', '2028-02-29')).toBe('active');
  });
});

describe('friendly deterministic motivation', () => {
  it('ships six non-empty alternatives for every scenario', () => {
    for (const phrases of Object.values(MOTIVATION_PHRASES)) {
      expect(phrases).toHaveLength(6);
      expect(new Set(phrases).size).toBe(6);
      expect(phrases.every(phrase => phrase.trim().length > 20)).toBe(true);
    }
  });
  it('stays stable on rerenders and rotates across local dates and challenges', () => {
    expect(motivate()).toEqual(motivate());
    const daily = Array.from({ length: 20 }, (_, i) => motivate({ today: `2026-10-${String(i + 2).padStart(2, '0')}` }).message);
    expect(new Set(daily).size).toBeGreaterThan(1);
    const challenges = Array.from({ length: 20 }, (_, i) => motivate({ challengeId: `reto-${i}` }).message);
    expect(new Set(challenges).size).toBeGreaterThan(1);
    expect(motivate({ rows: [...base.rows].reverse() })).toEqual(motivate());
  });
  it('treats missing own data as unknown, not a measured zero', () => {
    expect(motivate({ rows: [row('me', null), row('friend', null)] }).scenario).toBe('no-data');
    expect(motivate({ rows: [row('me', null), row('friend', 100)] }).scenario).toBe('no-data');
    expect(motivate({ rows: [row('me', 0), row('friend', 0)] }).scenario).toBe('starting');
    expect(motivate({ rows: [] }).scenario).toBe('no-data');
    expect(motivate({ rows: [row('friend', 100)] }).scenario).toBe('no-data');
  });
  it('does not turn invalid input numbers into a position or a health claim', () => {
    for (const steps of [-1, NaN, Infinity, 2.5]) {
      expect(motivate({ rows: [row('me', steps), row('friend', 100)] }).scenario).toBe('no-data');
    }
  });
  it('invites company when there is only one participant', () => {
    expect(motivate({ rows: [row('me', 0)] }).scenario).toBe('solo');
    expect(motivate({ rows: [row('me', 90)] }).scenario).toBe('solo');
  });
  it('uses recorded totals for behind, leading, and top ties', () => {
    expect(motivate().scenario).toBe('leading');
    expect(motivate({ rows: [row('me', 90), row('friend', 100)] }).scenario).toBe('behind');
    expect(motivate({ rows: [row('me', 0), row('friend', 100)] }).scenario).toBe('behind');
    expect(motivate({ rows: [row('me', 100), row('friend', 100)] }).scenario).toBe('tied');
    expect(motivate({ rows: [row('me', 100), row('friend', 100), row('third', 200)] }).scenario).toBe('behind');
  });
  it('never declares a winner while the challenge is ongoing, including its last day', () => {
    expect(motivate({ today: '2026-10-29' }).scenario).toBe('leading');
    expect(motivate({ today: '2026-10-30' }).scenario).toBe('finishing');
    expect(motivate({ today: '2026-10-31' }).scenario).toBe('finishing');
    expect(motivate({ today: '2026-10-31', rows: [row('me', 100), row('friend', 100)] }).scenario).toBe('tied');
  });
  it('makes active rankings explicitly provisional when another participant has no data', () => {
    const result = motivate({ rows: [row('me', 100), row('friend', null)] });
    expect(result.scenario).toBe('leading');
    expect(result.message).toContain('Clasificación provisional');
  });
  it('has a distinct pre-start scenario even if someone has data', () => {
    expect(motivate({ today: '2026-09-30' }).scenario).toBe('upcoming');
  });
  it('only awards a completed, nonzero, uncontested top recorded score', () => {
    const today = '2026-11-01';
    expect(motivate({ today }).scenario).toBe('winner');
    expect(motivate({ today, rows: [row('me', 100), row('friend', 100)] }).scenario).toBe('tied-finish');
    expect(motivate({ today, rows: [row('me', 100), row('friend', 200)] }).scenario).toBe('finished');
    expect(motivate({ today, rows: [row('me', 0), row('friend', 0)] }).scenario).toBe('finished');
    expect(motivate({ today, rows: [row('me', 100)] }).scenario).toBe('finished');
  });
  it('keeps final missing-data results provisional without declaring a winner', () => {
    for (const rows of [[row('me', 100), row('friend', null)], [row('me', null), row('friend', 100)], [], [row('friend', 100)]]) {
      const result = motivate({ today: '2026-11-01', rows });
      expect(result.scenario).toBe('incomplete');
      expect(result.eyebrow).toBe('Resultado provisional');
    }
  });
  it('keeps prize text intact and plain, including long values, HTML-like text, and replacement tokens', () => {
    const prize = `<img src=x onerror=alert(1)> $& ${'una cena muy especial '.repeat(80).trim()}`;
    const candidate = Array.from({ length: 20 }, (_, i) => motivate({ challengeId: `prize-${i}`, prize })).find(result => result.message.includes(prize));
    expect(candidate).toBeDefined();
    expect(candidate!.message).toContain(prize);
    expect(candidate!.eyebrow.length).toBeLessThan(60);
    const blankPrizeMessage = Array.from({ length: 20 }, (_, i) => motivate({ challengeId: `prize-${i}`, prize: '  ' })).find(result => result.message.includes('el premio'));
    expect(blankPrizeMessage).toBeDefined();
  });
});

describe('personal day, week, and month charts', () => {
  it('keeps empty, zero, and future days distinct', () => {
    const missing = groupPersonalSteps([], 'day', { today: '2026-10-31' });
    expect(missing.total).toBeNull(); expect(missing.recordedDays).toBe(0); expect(missing.elapsedDays).toBe(1);
    const zero = groupPersonalSteps([day('2026-10-31', 0)], 'day', { today: '2026-10-31' });
    expect(zero.total).toBe(0); expect(zero.recordedDays).toBe(1); expect(zero.buckets[0]!.steps).toBe(0);
    const future = groupPersonalSteps([day('2026-11-01', 9000)], 'day', { today: '2026-10-31', offset: 1 });
    expect(future.total).toBeNull(); expect(future.elapsedDays).toBe(0); expect(future.buckets[0]!.isFuture).toBe(true);
  });
  it('uses calendar weeks starting on Monday over DST and a month boundary', () => {
    const result = groupPersonalSteps([day('2026-10-25', 999), day('2026-10-26', 100), day('2026-10-31', 200), day('2026-11-01', 0)], 'week', { today: '2026-11-01' });
    expect(result.startDate).toBe('2026-10-26'); expect(result.endDate).toBe('2026-11-01');
    expect(result.buckets.map(bucket => bucket.key)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(result.total).toBe(300); expect(result.recordedDays).toBe(3); expect(result.elapsedDays).toBe(7);
    expect(result.label).toContain('2026');
  });
  it('does not count future days as zero or include their supplied steps', () => {
    const result = groupPersonalSteps([day('2026-10-26', 0), day('2026-10-28', 900)], 'week', { today: '2026-10-26' });
    expect(result.total).toBe(0); expect(result.recordedDays).toBe(1); expect(result.elapsedDays).toBe(1);
    expect(result.buckets.slice(1).every(bucket => bucket.steps === null && bucket.isFuture)).toBe(true);
  });
  it('paginates day, week, and month using their calendar units', () => {
    expect(groupPersonalSteps([], 'day', { today: '2026-01-01', offset: -1 }).startDate).toBe('2025-12-31');
    const week = groupPersonalSteps([], 'week', { today: '2026-01-01', offset: -1 });
    expect(week.startDate).toBe('2025-12-22'); expect(week.endDate).toBe('2025-12-28');
    const month = groupPersonalSteps([], 'month', { today: '2026-01-31', offset: -1 });
    expect(month.startDate).toBe('2025-12-01'); expect(month.endDate).toBe('2025-12-31');
    expect(month.label).toContain('2025'); expect(month.label).toContain('diciembre');
  });
  it('handles leap February and January-to-February offset without skipping a month', () => {
    const leap = groupPersonalSteps([day('2028-02-29', 29)], 'month', { today: '2028-02-29' });
    expect(leap.buckets).toHaveLength(29); expect(leap.total).toBe(29); expect(leap.endDate).toBe('2028-02-29');
    const feb = groupPersonalSteps([], 'month', { today: '2027-01-31', offset: 1 });
    expect(feb.startDate).toBe('2027-02-01'); expect(feb.endDate).toBe('2027-02-28'); expect(feb.elapsedDays).toBe(0);
  });
  it('replaces daily snapshots rather than adding duplicated uploads', () => {
    const days = [day('2026-10-31', 90), day('2026-10-31', 100), day('2026-10-30', 10)];
    expect(groupPersonalSteps(days, 'week', { today: '2026-10-31' }).total).toBe(110);
    expect(groupPersonalSteps(days, 'day', { today: '2026-10-31' }).recordedDays).toBe(1);
  });
  it('uses the latest snapshot timestamp even when uploads arrive out of order', () => {
    const days = [
      { ...day('2026-10-31', 100), syncedAt: '2026-10-31T16:00:00Z' },
      { ...day('2026-10-31', 90), syncedAt: '2026-10-31T15:00:00Z' },
    ];
    expect(groupPersonalSteps(days, 'day', { today: '2026-10-31' }).total).toBe(100);
  });
  it('ignores invalid dates and preserves invalid counts as unknown', () => {
    const result = groupPersonalSteps([day('2026-02-30', 500), day('2026-10-31', Infinity)], 'month', { today: '2026-10-31' });
    expect(result.total).toBeNull(); expect(result.recordedDays).toBe(0);
  });
  it('bounds charts and keeps calendar labels short independent of data size', () => {
    const result = groupPersonalSteps([], 'month', { today: '2026-10-31' });
    expect(result.buckets).toHaveLength(31); expect(result.label.length).toBeLessThan(64);
    expect(result.buckets.every(bucket => bucket.label.length < 20)).toBe(true);
    for (const offset of [0.5, NaN, Infinity, 1201, -1201]) expect(() => groupPersonalSteps([], 'day', { today: '2026-10-31', offset })).toThrow(RangeError);
    expect(() => groupPersonalSteps([], 'day', { today: 'invalid' })).toThrow(RangeError);
  });
});

describe('calendar-grouped personal history', () => {
  it('keeps months from different years separate and sorts newest first', () => {
    const result = summarizePersonalSteps([day('2025-10-01', 100), day('2026-10-01', 200), day('2026-10-31', 300), day('2026-09-01', null)], 'month');
    expect(result.map(bucket => [bucket.startDate, bucket.steps, bucket.recordedDays])).toEqual([
      ['2026-10-01', 500, 2], ['2026-09-01', null, 0], ['2025-10-01', 100, 1],
    ]);
    expect(result[0]!.label).toContain('2026'); expect(result[2]!.label).toContain('2025');
  });
  it('puts year-crossing calendar weeks in the same Monday bucket', () => {
    const result = summarizePersonalSteps([day('2026-12-31', 100), day('2027-01-01', 200), day('2027-01-04', 0)], 'week');
    expect(result.map(bucket => [bucket.startDate, bucket.endDate, bucket.steps])).toEqual([
      ['2027-01-04', '2027-01-10', 0], ['2026-12-28', '2027-01-03', 300],
    ]);
    expect(result[1]!.label).toContain('2026'); expect(result[1]!.label).toContain('2027');
  });
  it('deduplicates snapshots, handles empty input and bounds history lists', () => {
    expect(summarizePersonalSteps([], 'day')).toEqual([]);
    const days = [day('2026-10-29', 1), day('2026-10-30', 2), day('2026-10-31', 3), day('2026-10-31', 4)];
    expect(summarizePersonalSteps(days, 'day', 2).map(bucket => bucket.steps)).toEqual([4, 2]);
    for (const limit of [0, 1.5, 1201]) expect(() => summarizePersonalSteps(days, 'day', limit)).toThrow(RangeError);
  });
});
