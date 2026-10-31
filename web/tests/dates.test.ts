import { describe, expect, it } from 'vitest';
import { addDays, dateKey, duration, monday, sum, week } from '../src/dates';
describe('daily and weekly metrics', () => {
  it('uses the challenge zone, not the execution machine zone', () => {
    const date = new Date('2026-10-30T01:00:00Z');
    expect(dateKey(date, 'America/Toronto')).toBe('2026-10-29'); expect(dateKey(date, 'Europe/Madrid')).toBe('2026-10-30');
  });
  it('keeps seven calendar days over daylight-saving changes', () => {
    expect(week('2026-11-01')).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
    expect(monday('2027-01-01')).toBe('2026-12-28'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('does not turn no data into zero, or lose zero', () => {
    expect(sum([], 'steps')).toBeNull();
    const empty = { date: '2026-10-30', steps: 0, workoutSeconds: null, capturedAt: '', syncedAt: '' };
    expect(sum([empty], 'steps')).toBe(0); expect(sum([empty], 'workoutSeconds')).toBeNull(); expect(duration(null)).toBe('—'); expect(duration(3660)).toBe('1 h 1 min');
  });
});
