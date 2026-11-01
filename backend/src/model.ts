export type Challenge = {
  id: string; title: string; ownerId: string; startDate: string; endDate: string;
  timeZone: string; createdAt: string; prize?: string; prizeRule?: PrizeRule;
  participants?: { displayName: string }[];
};
export type PrizeRule = 'coordinate' | 'others' | 'creator';
export type BoardRow = { userId: string; displayName: string; steps: number | null; workoutSeconds: number | null; days: Activity[]; redacted?: boolean };
export type ChallengeResult = {
  closedAt: string; finalizedAt: string; outcome: 'winner' | 'tie' | 'incomplete' | 'solo' | 'no_data';
  winnerUserIds: string[]; payerUserIds: string[]; prizeRule: PrizeRule;
  hasMissingData: boolean; hasRedactions: boolean; receivedAt: string | null; receivedBy: string | null;
};
export type FrozenResult = ChallengeResult & { rows: BoardRow[] };
export type Leaderboard = { challenge: Challenge; rows: BoardRow[]; result: ChallengeResult | null };
export type Member = { userId: string; displayName: string; joinedAt: string; shareConsentAt: string };
export type Activity = {
  date: string; steps: number | null; workoutSeconds: number | null;
  capturedAt: string; syncedAt: string;
  source?: 'manual' | 'shortcuts' | 'mixed';
};
export type Invite = { challengeId: string; expiresAt: number };
export type Connection = { challengeId: string; userId: string; expiresAt: number; hash: string };
export type PrivateProfile = { displayName: string; timeZone: string | null; codeSeed: string; codeHash: string };
export type PersonalSteps = { date: string; steps: number; capturedAt: string; syncedAt: string };
export interface Repository {
  ensurePrivateProfile(userId: string, codeSeed: string, codeHash: string): Promise<PrivateProfile>;
  updateTimeZone(userId: string, timeZone: string): Promise<void>;
  rotateCode(userId: string, codeSeed: string, codeHash: string): Promise<void>;
  repairCode(userId: string, previousHash: string, codeSeed: string, codeHash: string): Promise<PrivateProfile>;
  legacyPersonalActivity(userId: string): Promise<PersonalSteps[]>;
  stepIdentity(codeHash: string): Promise<{ userId: string; timeZone: string | null } | undefined>;
  personalActivity(userIds: string[]): Promise<(PersonalSteps & { userId: string; timeZone?: string | null })[]>;
  savePersonalSteps(userId: string, day: PersonalSteps, codeHash: string, timeZone: string): Promise<PersonalSteps>;
  profile(userId: string): Promise<string | undefined>;
  saveProfile(userId: string, displayName: string): Promise<void>;
  createChallenge(challenge: Challenge, member: Member): Promise<void>;
  challenge(id: string): Promise<Challenge | undefined>;
  challenges(userId: string): Promise<Challenge[]>;
  leaderboard(id: string, userId: string, now: Date): Promise<Leaderboard>;
  receivePrize(id: string, userId: string, now: Date): Promise<ChallengeResult>;
  member(id: string, userId: string): Promise<Member | undefined>;
  members(id: string): Promise<Member[]>;
  saveInvite(hash: string, invite: Invite): Promise<void>;
  invite(hash: string): Promise<Invite | undefined>;
  join(hash: string, member: Member, now: number): Promise<void>;
  saveActivity(id: string, userId: string, activity: Activity[], connectionHash?: string): Promise<void>;
  activity(id: string): Promise<(Activity & { userId: string })[]>;
  saveConnection(connection: Connection): Promise<void>;
  connection(hash: string): Promise<Connection | undefined>;
  activeConnection(id: string, userId: string): Promise<Connection | undefined>;
  revokeConnection(id: string, userId: string): Promise<void>;
  clearActivity(id: string, userId: string): Promise<void>;
  leave(id: string, userId: string): Promise<void>;
  deleteChallenge(id: string): Promise<void>;
  deleteProfile(userId: string): Promise<void>;
}
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requiredString(value: unknown, name: string, max = 100): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new HttpError(400, `${name} no es válido.`);
  }
  return value.trim();
}
export function dateOnly(value: unknown): string {
  const date = requiredString(value, 'Fecha', 10);
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new HttpError(400, 'Fecha no válida.');
  }
  return date;
}
export function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, 'Hora no válida.');
  return new Date(value).toISOString();
}
