import { randomUUID } from 'node:crypto';
import type { Activity, BoardRow, Challenge, ChallengeResult, FrozenResult, Member, PersonalSteps } from './model.js';
import { HttpError } from './model.js';

export const localDate = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const boundaries = new Map<string, string>();
// Find the first instant of the following calendar day, not "24 hours later" (DST days vary).
export function closingInstant(challenge: Pick<Challenge, 'endDate' | 'timeZone'>): string {
  const key = `${challenge.endDate}/${challenge.timeZone}`, cached = boundaries.get(key);
  if (cached) return cached;
  const next = Date.parse(`${challenge.endDate}T00:00:00Z`) + 86400000;
  const date = new Date(next).toISOString().slice(0, 10);
  let low = next - 48 * 3600000, high = next + 48 * 3600000;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: challenge.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  while (low < high) { const middle = Math.floor((low + high) / 2); if (format.format(new Date(middle)) < date) low = middle + 1; else high = middle; }
  const result = new Date(low).toISOString();
  if (boundaries.size >= 500) boundaries.clear();
  boundaries.set(key, result); return result;
}
export const isClosed = (challenge: Pick<Challenge, 'endDate' | 'timeZone'>, now: Date) => now.getTime() >= Date.parse(closingInstant(challenge));
export function requireOpen(challenge: Challenge, now: Date) {
  if (isClosed(challenge, now)) throw new HttpError(409, 'Este reto ya terminó. Su resultado no admite cambios.');
}
type StepSnapshot = PersonalSteps & { userId: string; timeZone?: string | null };
export function boardRows(challenge: Challenge, members: Member[], activity: (Activity & { userId: string })[], personal: StepSnapshot[], cutoff?: string): BoardRow[] {
  const beforeCutoff = (day: { syncedAt: string }) => !cutoff || Date.parse(day.syncedAt) < Date.parse(cutoff);
  return members.map(person => {
    const combined = new Map(activity.filter(row => row.userId === person.userId && beforeCutoff(row)).map(row => [row.date, row]));
    const latest = new Map<string, StepSnapshot>();
    for (const row of personal.filter(d => d.userId === person.userId && beforeCutoff(d))) {
      if (row.date < localDate(new Date(person.joinedAt), row.timeZone ?? challenge.timeZone)) continue;
      const previous = latest.get(row.date);
      if (!previous || Date.parse(previous.capturedAt) < Date.parse(row.capturedAt) || (Date.parse(previous.capturedAt) === Date.parse(row.capturedAt) && Date.parse(previous.syncedAt) <= Date.parse(row.syncedAt))) latest.set(row.date, row);
    }
    for (const row of latest.values()) {
      const previous = combined.get(row.date);
      if (!previous || Date.parse(previous.capturedAt) <= Date.parse(row.capturedAt)) combined.set(row.date, { userId: row.userId, date: row.date, steps: row.steps, capturedAt: row.capturedAt, syncedAt: row.syncedAt, workoutSeconds: previous?.workoutSeconds ?? null, source: previous?.workoutSeconds != null ? 'mixed' : 'shortcuts' });
    }
    const days = [...combined.values()].filter(row => row.date >= challenge.startDate && row.date <= challenge.endDate);
    const sum = (key: 'steps' | 'workoutSeconds') => { const values = days.flatMap(day => day[key] === null ? [] : [day[key]!]); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
    return { userId: person.userId, displayName: person.displayName, steps: sum('steps'), workoutSeconds: sum('workoutSeconds'), days: days.map(({ userId: _, ...day }) => day).sort((a, b) => a.date.localeCompare(b.date)) };
  });
}
export function finalizeResult(challenge: Challenge, rows: BoardRow[], now: Date): FrozenResult {
  const hasMissingData = rows.some(row => row.steps === null);
  const maximum = Math.max(0, ...rows.map(row => row.steps ?? 0));
  const leaders = rows.filter(row => row.steps === maximum).map(row => row.userId);
  const outcome: ChallengeResult['outcome'] = rows.length < 2 ? 'solo' : hasMissingData ? 'incomplete' : maximum === 0 ? 'no_data' : leaders.length > 1 ? 'tie' : 'winner';
  const winnerUserIds = outcome === 'winner' || outcome === 'tie' ? leaders : [];
  const prizeRule = challenge.prizeRule ?? 'coordinate';
  const payerUserIds = !challenge.prize?.trim() || outcome !== 'winner' ? [] : prizeRule === 'others' ? rows.filter(row => !winnerUserIds.includes(row.userId)).map(row => row.userId) : prizeRule === 'creator' && !winnerUserIds.includes(challenge.ownerId) ? [challenge.ownerId] : [];
  return { closedAt: closingInstant(challenge), finalizedAt: now.toISOString(), outcome, winnerUserIds, payerUserIds, prizeRule, hasMissingData, hasRedactions: false, receivedAt: null, receivedBy: null, rows: structuredClone(rows) };
}
export const resultMetadata = ({ rows: _, ...result }: FrozenResult): ChallengeResult => result;
export function confirmReceipt(challenge: Challenge, frozen: FrozenResult | null, userId: string, now: Date): FrozenResult {
  if (!frozen || !isClosed(challenge, now)) throw new HttpError(409, 'El premio se confirma cuando termina el reto.');
  if (!challenge.prize?.trim() || frozen.outcome !== 'winner' || !frozen.winnerUserIds.includes(userId) || !frozen.rows.some(row => row.userId === userId && !row.redacted)) throw new HttpError(403, 'Solo quien ganó puede confirmar que recibió el premio.');
  return frozen.receivedAt ? frozen : { ...frozen, receivedAt: now.toISOString(), receivedBy: userId };
}
// Withdrawal removes identity and health data, never crowns somebody else retroactively.
export function redactResult(frozen: FrozenResult, userId: string): FrozenResult {
  if (!frozen.rows.some(row => row.userId === userId)) return frozen;
  const tombstone = `removed-${randomUUID()}`;
  return { ...frozen, hasRedactions: true,
    winnerUserIds: frozen.winnerUserIds.map(id => id === userId ? tombstone : id),
    payerUserIds: frozen.payerUserIds.filter(id => id !== userId),
    receivedBy: frozen.receivedBy === userId ? null : frozen.receivedBy,
    rows: frozen.rows.map(row => row.userId === userId ? { userId: tombstone, displayName: 'Participante que salió', steps: null, workoutSeconds: null, days: [], redacted: true } : row) };
}
