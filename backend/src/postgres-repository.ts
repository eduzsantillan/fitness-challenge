import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { Activity, Challenge, Connection, FrozenResult, HttpError, Invite, Leaderboard, Member, PersonalSteps, PrivateProfile, Repository } from './model.js';
import { boardRows, closingInstant, confirmReceipt, finalizeResult, isClosed, redactResult, requireOpen, resultMetadata } from './completion.js';

const challengeColumns = `id, title, owner_id AS "ownerId", start_date::text AS "startDate", end_date::text AS "endDate", time_zone AS "timeZone", prize, prize_rule AS "prizeRule", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt"`;
const activityColumns = `user_id AS "userId", date::text, steps, workout_seconds AS "workoutSeconds", to_char(captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt", to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "syncedAt", source`;
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
  private async transactionNow(client: PoolClient, earliest?: Date) {
    const date = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
    return earliest && earliest > date ? earliest : date;
  }
  private async requireOpenWrite(client: PoolClient, id: string, earliest?: Date) {
    const row = (await client.query<Challenge & { result: FrozenResult | null }>(`SELECT ${challengeColumns},result FROM challenges WHERE id=$1`, [id])).rows[0];
    if (!row) throw new HttpError(404, 'El reto ya no existe.');
    const now = await this.transactionNow(client, earliest);
    requireOpen(row, now);
    if (row.result) throw new HttpError(409, 'El resultado del reto ya está cerrado.');
    return now;
  }
  private async boardWithin(client: PoolClient, id: string, userId: string, requestedNow: Date): Promise<Leaderboard & { frozen: FrozenResult | null }> {
    await this.requireMember(client, id, userId);
    const value = (await client.query<Challenge & { result: FrozenResult | null }>(`SELECT ${challengeColumns},result FROM challenges WHERE id=$1`, [id])).rows[0];
    if (!value) throw new HttpError(404, 'Reto no encontrado.');
    const { result: stored, ...challenge } = value;
    if (stored) return { challenge, rows: stored.rows, result: resultMetadata(stored), frozen: stored };
    const members = (await client.query<Member>(`${memberQuery} WHERE m.challenge_id=$1 ORDER BY m.joined_at,m.user_id`, [id])).rows;
    // The same ordering as archive/deletion; personal writes take only their user's lock.
    for (const userId of members.map(m => m.userId).sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`user:${userId}`]);
    const now = await this.transactionNow(client, requestedNow), closed = isClosed(challenge, now), cutoff = closed ? closingInstant(challenge) : null;
    const activity = (await client.query<Activity & { userId: string }>(`SELECT ${activityColumns} FROM daily_activity WHERE challenge_id=$1 ORDER BY date`, [id])).rows;
    const personal = closed ? (await client.query<PersonalSteps & { userId: string; timeZone: string | null }>(`SELECT user_id AS "userId",date::text,steps,time_zone AS "timeZone",
      to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt",to_char(synced_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "syncedAt"
      FROM personal_step_history WHERE user_id=ANY($1::text[]) AND synced_at < $2::timestamptz AND date BETWEEN $3::date AND $4::date ORDER BY captured_at,synced_at,id`, [members.map(m => m.userId), cutoff, challenge.startDate, challenge.endDate])).rows
      : (await client.query<PersonalSteps & { userId: string; timeZone: string | null }>(`SELECT s.user_id AS "userId",date::text,steps,p.time_zone AS "timeZone",
      to_char(captured_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt",to_char(synced_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "syncedAt"
      FROM personal_steps s LEFT JOIN profiles p ON p.user_id=s.user_id WHERE s.user_id=ANY($1::text[]) ORDER BY date`, [members.map(m => m.userId)])).rows;
    const rows = boardRows(challenge, members, activity, personal, cutoff ?? undefined);
    let frozen: FrozenResult | null = null;
    if (closed) {
      frozen = finalizeResult(challenge, rows, now);
      // Older mutable versions cannot be reconstructed retroactively. Do not infer a winner
      // when an in-range row was overwritten after cutoff before this history migration.
      const ambiguous = await client.query(`SELECT 1 FROM personal_steps s WHERE s.user_id=ANY($1::text[]) AND s.date BETWEEN $2::date AND $3::date AND s.synced_at >= $4::timestamptz
        AND NOT EXISTS (SELECT 1 FROM personal_step_history h WHERE h.user_id=s.user_id AND h.date=s.date AND h.synced_at < $4::timestamptz)
        UNION ALL SELECT 1 FROM daily_activity d WHERE d.challenge_id=$5 AND d.synced_at >= $4::timestamptz LIMIT 1`, [members.map(m => m.userId), challenge.startDate, challenge.endDate, cutoff, id]);
      if (ambiguous.rowCount && frozen.outcome !== 'solo') frozen = { ...frozen, outcome: 'incomplete', winnerUserIds: [], payerUserIds: [], hasMissingData: true };
      await client.query('UPDATE challenges SET result=$2::jsonb WHERE id=$1', [id, JSON.stringify(frozen)]);
    }
    return { challenge, rows, result: frozen ? resultMetadata(frozen) : null, frozen };
  }
  async leaderboard(id: string, userId: string, now: Date) {
    return this.write(id, async client => { const { frozen: _, ...board } = await this.boardWithin(client, id, userId, now); return board; });
  }
  async receivePrize(id: string, userId: string, now: Date) {
    return this.write(id, async client => {
      const board = await this.boardWithin(client, id, userId, now);
      const frozen = confirmReceipt(board.challenge, board.frozen, userId, await this.transactionNow(client, now));
      await client.query('UPDATE challenges SET result=$2::jsonb WHERE id=$1', [id, JSON.stringify(frozen)]);
      return resultMetadata(frozen);
    });
  }
  private async redactFrozen(client: PoolClient, id: string, userId: string) {
    const row = (await client.query<{ result: FrozenResult | null }>('SELECT result FROM challenges WHERE id=$1', [id])).rows[0];
    if (row?.result) await client.query('UPDATE challenges SET result=$2::jsonb WHERE id=$1', [id, JSON.stringify(redactResult(row.result, userId))]);
  }
  async ensurePrivateProfile(userId: string, codeSeed: string, codeHash: string) {
    const row = await this.one<PrivateProfile>(`INSERT INTO profiles(user_id, display_name, code_seed, code_hash)
      SELECT id, name, $2, $3 FROM auth_user WHERE id=$1
      ON CONFLICT (user_id) DO UPDATE SET code_seed=COALESCE(profiles.code_seed, EXCLUDED.code_seed), code_hash=COALESCE(profiles.code_hash, EXCLUDED.code_hash)
      RETURNING display_name AS "displayName", time_zone AS "timeZone", code_seed AS "codeSeed", code_hash AS "codeHash"`, [userId, codeSeed, codeHash]);
    if (!row) throw new HttpError(401, 'Inicia sesión.');
    return row;
  }
  async updateTimeZone(userId: string, timeZone: string) {
    await this.write(`user:${userId}`, async client => { await client.query('UPDATE profiles SET time_zone=$2 WHERE user_id=$1', [userId, timeZone]); });
  }
  async rotateCode(userId: string, codeSeed: string, codeHash: string) {
    await this.write(`user:${userId}`, async client => { await client.query('UPDATE profiles SET code_seed=$2, code_hash=$3 WHERE user_id=$1', [userId, codeSeed, codeHash]); });
  }
  async repairCode(userId: string, previousHash: string, codeSeed: string, codeHash: string) {
    return this.write(`user:${userId}`, async client => {
      // Only one reader repairs an obsolete derivation. Other readers return the canonical winning code.
      await client.query('UPDATE profiles SET code_seed=$3,code_hash=$4 WHERE user_id=$1 AND code_hash=$2', [userId, previousHash, codeSeed, codeHash]);
      const p = (await client.query<PrivateProfile>('SELECT display_name AS "displayName", time_zone AS "timeZone", code_seed AS "codeSeed", code_hash AS "codeHash" FROM profiles WHERE user_id=$1', [userId])).rows[0];
      if (!p) throw new HttpError(401, 'Inicia sesión.');
      return p;
    });
  }
  private async preserveLegacy(client: PoolClient, userIds: string[]) {
    const users = [...new Set(userIds)].sort();
    if (!users.length) return;
    // Lock ordering is challenge -> sorted user IDs. Personal writes/deletion take only user locks.
    for (const userId of users) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`user:${userId}`]);
    await client.query(`INSERT INTO legacy_step_archive(user_id,date,steps,captured_at,synced_at,source_challenge_id)
      SELECT DISTINCT ON (d.user_id,d.date) d.user_id,d.date,d.steps,d.captured_at,d.synced_at,d.challenge_id
      FROM daily_activity d WHERE d.user_id=ANY($1::text[]) AND d.steps IS NOT NULL
      ORDER BY d.user_id,d.date,d.captured_at DESC,d.synced_at DESC,d.challenge_id
      ON CONFLICT (user_id,date) DO UPDATE SET steps=EXCLUDED.steps,captured_at=EXCLUDED.captured_at,synced_at=EXCLUDED.synced_at,source_challenge_id=EXCLUDED.source_challenge_id
      WHERE (legacy_step_archive.captured_at,legacy_step_archive.synced_at) < (EXCLUDED.captured_at,EXCLUDED.synced_at)
        OR ((legacy_step_archive.captured_at,legacy_step_archive.synced_at) = (EXCLUDED.captured_at,EXCLUDED.synced_at) AND legacy_step_archive.source_challenge_id > EXCLUDED.source_challenge_id)`, [users]);
  }
  async legacyPersonalActivity(userId: string) {
    return (await this.pool.query<PersonalSteps>(`SELECT DISTINCT ON (d.date) d.date::text, d.steps,
      to_char(d.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt",
      to_char(d.synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "syncedAt"
      FROM (
        SELECT date,steps,captured_at,synced_at,challenge_id AS source_challenge_id FROM daily_activity WHERE user_id=$1 AND steps IS NOT NULL
        UNION ALL
        SELECT date,steps,captured_at,synced_at,source_challenge_id FROM legacy_step_archive WHERE user_id=$1
      ) d ORDER BY d.date,d.captured_at DESC,d.synced_at DESC,d.source_challenge_id`, [userId])).rows;
  }
  async stepIdentity(codeHash: string) { return this.one<{ userId: string; timeZone: string | null }>('SELECT user_id AS "userId", time_zone AS "timeZone" FROM profiles WHERE code_hash=$1', [codeHash]); }
  async personalActivity(userIds: string[]) {
    if (!userIds.length) return [];
    return (await this.pool.query<PersonalSteps & { userId: string; timeZone: string | null }>(`SELECT s.user_id AS "userId", s.date::text, s.steps, p.time_zone AS "timeZone",
      to_char(captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "capturedAt",
      to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "syncedAt"
      FROM personal_steps s LEFT JOIN profiles p ON p.user_id=s.user_id WHERE s.user_id=ANY($1::text[]) ORDER BY s.date`, [userIds])).rows;
  }
  async savePersonalSteps(userId: string, day: PersonalSteps, codeHash: string, timeZone: string) {
    return this.write(`user:${userId}`, async client => {
      const current = (await client.query<{ timeZone: string | null }>('SELECT time_zone AS "timeZone" FROM profiles WHERE user_id=$1 AND code_hash=$2', [userId, codeHash])).rows[0];
      if (!current) throw new HttpError(401, 'Código de usuario no válido.');
      if (current.timeZone !== timeZone) throw new HttpError(409, 'La zona horaria cambió. Vuelve a enviar los pasos.');
      // Stamp arrival after the lock: a queued pre-midnight request must not become
      // cutoff-eligible evidence after another transaction has frozen the result.
      const syncedAt = (await this.transactionNow(client)).toISOString();
      const saved = await client.query(`INSERT INTO personal_steps(user_id,date,steps,captured_at,synced_at) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (user_id,date) DO UPDATE SET steps=EXCLUDED.steps, captured_at=EXCLUDED.captured_at, synced_at=EXCLUDED.synced_at
        WHERE personal_steps.captured_at <= EXCLUDED.captured_at RETURNING user_id`, [userId, day.date, day.steps, day.capturedAt, syncedAt]);
      if (saved.rowCount) await client.query('INSERT INTO personal_step_history(user_id,date,steps,captured_at,synced_at,time_zone) VALUES ($1,$2,$3,$4,$5,$6)', [userId, day.date, day.steps, day.capturedAt, syncedAt, timeZone]);
      return { ...day, syncedAt };
    });
  }
  async profile(userId: string) { return (await this.one<{ name: string }>('SELECT COALESCE(p.display_name, u.name) AS name FROM auth_user u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=$1', [userId]))?.name; }
  async saveProfile(userId: string, displayName: string) { await this.pool.query('INSERT INTO profiles(user_id, display_name) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET display_name=EXCLUDED.display_name', [userId, displayName]); }
  async createChallenge(c: Challenge, m: Member) {
    await this.write(c.id, async client => {
      await client.query('INSERT INTO challenges(id,title,owner_id,start_date,end_date,time_zone,created_at,prize,prize_rule) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [c.id, c.title, c.ownerId, c.startDate, c.endDate, c.timeZone, c.createdAt, c.prize ?? '', c.prizeRule ?? 'coordinate']);
      await client.query('INSERT INTO memberships VALUES ($1,$2,$3,$4)', [c.id, m.userId, m.joinedAt, m.shareConsentAt]);
    });
  }
  async challenge(id: string) { return this.one<Challenge>(`SELECT ${challengeColumns} FROM challenges WHERE id=$1`, [id]); }
  async challenges(userId: string) { return (await this.pool.query<Challenge>(`SELECT ${challengeColumns}, COALESCE((SELECT json_agg(json_build_object('displayName', COALESCE(p.display_name,u.name)) ORDER BY m.joined_at,m.user_id) FROM memberships m JOIN auth_user u ON u.id=m.user_id LEFT JOIN profiles p ON p.user_id=m.user_id WHERE m.challenge_id=challenges.id),'[]'::json) AS participants FROM challenges WHERE id IN (SELECT challenge_id FROM memberships WHERE user_id=$1) ORDER BY created_at DESC, id`, [userId])).rows; }
  async member(id: string, userId: string) { return this.one<Member>(`${memberQuery} WHERE m.challenge_id=$1 AND m.user_id=$2`, [id, userId]); }
  async members(id: string) { return (await this.pool.query<Member>(`${memberQuery} WHERE m.challenge_id=$1 ORDER BY m.joined_at, m.user_id`, [id])).rows; }
  async saveInvite(hash: string, invite: Invite) {
    await this.write(invite.challengeId, async client => {
      if (!(await client.query('SELECT 1 FROM challenges WHERE id=$1', [invite.challengeId])).rowCount) throw new HttpError(404, 'El reto ya no existe.');
      await this.requireOpenWrite(client, invite.challengeId);
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
      await this.requireOpenWrite(client, invitation.challengeId, new Date(now * 1000));
      await client.query('INSERT INTO memberships VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [invitation.challengeId, m.userId, m.joinedAt, m.shareConsentAt]);
    });
  }
  async saveActivity(id: string, userId: string, days: Activity[], connectionHash?: string) {
    await this.write(id, async client => {
      await this.requireMember(client, id, userId);
      const receivedAt = await this.requireOpenWrite(client, id);
      if (connectionHash && !(await client.query('SELECT 1 FROM shortcut_connections WHERE challenge_id=$1 AND user_id=$2 AND hash=$3 AND expires_at > extract(epoch FROM now())', [id, userId, connectionHash])).rowCount) throw new HttpError(401, 'Conexión caducada o revocada.');
      for (const d of days) {
        // Preserve workout at write time, not from a stale read done before a concurrent manual update.
        const preserve = d.source === 'shortcuts' && d.workoutSeconds === null;
        await client.query(`INSERT INTO daily_activity VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (challenge_id,user_id,date) DO UPDATE SET steps=EXCLUDED.steps,
          workout_seconds=CASE WHEN $9 THEN daily_activity.workout_seconds ELSE EXCLUDED.workout_seconds END,
          captured_at=EXCLUDED.captured_at, synced_at=EXCLUDED.synced_at,
          source=CASE WHEN $9 AND daily_activity.workout_seconds IS NOT NULL THEN 'mixed' ELSE EXCLUDED.source END
          WHERE daily_activity.captured_at <= EXCLUDED.captured_at`, [id, userId, d.date, d.steps, d.workoutSeconds, d.capturedAt, receivedAt.toISOString(), d.source ?? 'manual', preserve]);
      }
    });
  }
  async activity(id: string) {
    return (await this.pool.query<Activity & { userId: string }>(`SELECT ${activityColumns} FROM daily_activity WHERE challenge_id=$1 ORDER BY date`, [id])).rows;
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
      await this.redactFrozen(client, id, userId);
      await client.query('DELETE FROM shortcut_connections WHERE challenge_id=$1 AND user_id=$2', [id, userId]);
      await client.query('DELETE FROM daily_activity WHERE challenge_id=$1 AND user_id=$2', [id, userId]);
    });
  }
  async leave(id: string, userId: string) {
    await this.write(id, async client => {
      await this.redactFrozen(client, id, userId);
      await this.preserveLegacy(client, [userId]);
      await client.query('DELETE FROM memberships WHERE challenge_id=$1 AND user_id=$2', [id, userId]);
    });
  }
  async deleteChallenge(id: string) {
    await this.write(id, async client => {
      const members = await client.query<{ userId: string }>('SELECT user_id AS "userId" FROM memberships WHERE challenge_id=$1', [id]);
      await this.preserveLegacy(client, members.rows.map(m => m.userId));
      await client.query('DELETE FROM challenges WHERE id=$1', [id]);
    });
  }
  async deleteProfile(userId: string) {
    await this.write(`user:${userId}`, async client => {
      await client.query('DELETE FROM personal_steps WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM personal_step_history WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM legacy_step_archive WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM profiles WHERE user_id=$1', [userId]);
    });
  }
}
