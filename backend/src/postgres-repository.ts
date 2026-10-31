import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { Activity, Challenge, Connection, HttpError, Invite, Member, Repository } from './model.js';

const challengeColumns = `id, title, owner_id AS "ownerId", start_date::text AS "startDate", end_date::text AS "endDate", time_zone AS "timeZone", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;
const connectionColumns = `challenge_id AS "challengeId", user_id AS "userId", hash, expires_at::float8 AS "expiresAt"`;
const memberQuery = `SELECT m.user_id AS "userId", COALESCE(p.display_name, u.name) AS "displayName", m.joined_at AS "joinedAt", m.share_consent_at AS "shareConsentAt" FROM memberships m JOIN auth_user u ON u.id=m.user_id LEFT JOIN profiles p ON p.user_id=m.user_id`;

export class PostgresRepository implements Repository {
  constructor(private pool: Pool) {}
  private async one<T extends QueryResultRow>(sql: string, values: unknown[]): Promise<T | undefined> { return (await this.pool.query<T>(sql, values)).rows[0]; }
  // All challenge writes share one transaction-scoped lock. Revoke/leave/delete cannot race a late ingest.
  private async write<T>(id: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [id]); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async requireMember(client: PoolClient, id: string, userId: string) {
    if (!(await client.query('SELECT 1 FROM memberships WHERE challenge_id=$1 AND user_id=$2', [id, userId])).rowCount) throw new HttpError(403, 'No perteneces al reto.');
  }
  async profile(userId: string) { return (await this.one<{ name: string }>('SELECT COALESCE(p.display_name, u.name) AS name FROM auth_user u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1', [userId]))?.name; }
  async saveProfile(userId: string, displayName: string) { await this.pool.query('INSERT INTO profiles(user_id, display_name) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name', [userId, displayName]); }
  async createChallenge(c: Challenge, m: Member) {
    await this.write(c.id, async client => {
      await client.query('INSERT INTO challenges VALUES ($1,$2,$3,$4,$5,$6,$7)', [c.id, c.title, c.ownerId, c.startDate, c.endDate, c.timeZone, c.createdAt]);
      await client.query('INSERT INTO memberships VALUES ($1,$2,$3,$4)', [c.id, m.userId, m.joinedAt, m.shareConsentAt]);
    });
  }
  async challenge(id: string) { return this.one<Challenge>(`SELECT ${challengeColumns} FROM challenges WHERE id=$1`, [id]); }
  async challenges(userId: string) { return (await this.pool.query<Challenge>(`SELECT ${challengeColumns} FROM challenges WHERE id IN (SELECT challenge_id FROM memberships WHERE user_id=$1) ORDER BY created_at DESC, id`, [userId])).rows; }
  async member(id: string, userId: string) { return this.one<Member>(`${memberQuery} WHERE m.challenge_id=$1 AND m.user_id=$2`, [id, userId]); }
  async members(id: string) { return (await this.pool.query<Member>(`${memberQuery} WHERE m.challenge_id=$1 ORDER BY m.joined_at, m.user_id`, [id])).rows; }
  async saveInvite(hash: string, invite: Invite) {
    await this.write(invite.challengeId, async client => {
      if (!(await client.query('SELECT 1 FROM challenges WHERE id=$1', [invite.challengeId])).rowCount) throw new HttpError(404, 'El reto ya no existe.');
      await client.query('DELETE FROM invitations WHERE challenge_id=$1 AND expires_at <= extract(epoch FROM now())', [invite.challengeId]);
      await client.query('INSERT INTO invitations VALUES ($1,$2,$3)', [hash, invite.challengeId, invite.expiresAt]);
    });
  }
  async invite(hash: string) { return this.one<Invite>('SELECT challenge_id AS "challengeId", expires_at::float8 AS "expiresAt" FROM invitations WHERE hash=$1', [hash]); }
  async join(hash: string, m: Member, now: number) {
    const invitation = await this.invite(hash);
    if (!invitation) throw new HttpError(404, 'Invitación caducada.');
    await this.write(invitation.challengeId, async client => {
      const current = await client.query('SELECT challenge_id FROM invitations WHERE hash=$1 AND expires_at > $2', [hash, now]);
      if (!current.rowCount) throw new HttpError(404, 'Invitación caducada.');
      await client.query('INSERT INTO memberships VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [invitation.challengeId, m.userId, m.joinedAt, m.shareConsentAt]);
    });
  }
  async saveActivity(id: string, userId: string, days: Activity[], connectionHash?: string) {
    await this.write(id, async client => {
      await this.requireMember(client, id, userId);
      if (connectionHash && !(await client.query('SELECT 1 FROM shortcut_connections WHERE challenge_id=$1 AND user_id=$2 AND hash=$3 AND expires_at > extract(epoch FROM now())', [id, userId, connectionHash])).rowCount) throw new HttpError(401, 'Conexión caducada o revocada.');
      for (const d of days) {
        // Preserve workout at write time, not from a stale read done before a concurrent manual update.
        const preserve = d.source === 'shortcuts' && d.workoutSeconds === null;
        await client.query(`INSERT INTO daily_activity VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (challenge_id,user_id,date) DO UPDATE SET steps=EXCLUDED.steps,
          workout_seconds=CASE WHEN $9 THEN daily_activity.workout_seconds ELSE EXCLUDED.workout_seconds END,
          captured_at=EXCLUDED.captured_at, synced_at=EXCLUDED.synced_at,
          source=CASE WHEN $9 AND daily_activity.workout_seconds IS NOT NULL THEN 'mixed' ELSE EXCLUDED.source END
          WHERE daily_activity.captured_at <= EXCLUDED.captured_at`, [id, userId, d.date, d.steps, d.workoutSeconds, d.capturedAt, d.syncedAt, d.source ?? 'manual', preserve]);
      }
    });
  }
  async activity(id: string) {
    return (await this.pool.query<Activity & { userId: string }>(`SELECT user_id AS "userId", date::text, steps, workout_seconds AS "workoutSeconds", to_char(captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt", to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "syncedAt", source FROM daily_activity WHERE challenge_id=$1 ORDER BY date`, [id])).rows;
  }
  async saveConnection(c: Connection) {
    await this.write(c.challengeId, async client => {
      await this.requireMember(client, c.challengeId, c.userId);
      await client.query('INSERT INTO shortcut_connections VALUES ($1,$2,$3,$4) ON CONFLICT (challenge_id,user_id) DO UPDATE SET hash=EXCLUDED.hash, expires_at=EXCLUDED.expires_at', [c.challengeId, c.userId, c.hash, c.expiresAt]);
    });
  }
  async connection(hash: string) { return this.one<Connection>(`SELECT ${connectionColumns} FROM shortcut_connections WHERE hash=$1`, [hash]); }
  async activeConnection(id: string, userId: string) { return this.one<Connection>(`SELECT ${connectionColumns} FROM shortcut_connections WHERE challenge_id=$1 AND user_id=$2`, [id, userId]); }
  async revokeConnection(id: string, userId: string) { await this.write(id, async client => { await client.query('DELETE FROM shortcut_connections WHERE challenge_id=$1 AND user_id=$2', [id, userId]); }); }
  async clearActivity(id: string, userId: string) {
    await this.write(id, async client => {
      await client.query('DELETE FROM shortcut_connections WHERE challenge_id=$1 AND user_id=$2', [id, userId]);
      await client.query('DELETE FROM daily_activity WHERE challenge_id=$1 AND user_id=$2', [id, userId]);
    });
  }
  async leave(id: string, userId: string) { await this.write(id, async client => { await client.query('DELETE FROM memberships WHERE challenge_id=$1 AND user_id=$2', [id, userId]); }); }
  async deleteChallenge(id: string) { await this.write(id, async client => { await client.query('DELETE FROM challenges WHERE id=$1', [id]); }); }
  async deleteProfile(userId: string) { await this.pool.query('DELETE FROM profiles WHERE user_id=$1', [userId]); }
}
