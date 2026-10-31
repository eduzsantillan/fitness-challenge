import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Activity, HttpError, Repository, PrivateProfile, PrizeRule, dateOnly, instant, requiredString } from './model.js';
import { requireOpen } from './completion.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export class ChallengeService {
  constructor(private db: Repository, private now = () => new Date(), private codeSecret = 'isolated-test-only-capability-secret') {}
  private userCode(userId: string, seed: string) { return createHmac('sha256', this.codeSecret).update(`ritmo.steps.v1:${userId}:${seed}`).digest('base64url'); }
  private async ownProfile(userId: string) {
    const seed = randomBytes(32).toString('base64url');
    const profile = await this.db.ensurePrivateProfile(userId, seed, tokenHash(this.userCode(userId, seed)));
    // Rotating the application secret invalidates previous derivations on the next profile read.
    if (tokenHash(this.userCode(userId, profile.codeSeed)) !== profile.codeHash) {
      return this.db.repairCode(userId, profile.codeHash, seed, tokenHash(this.userCode(userId, seed)));
    }
    return profile;
  }
  private publicOwnProfile(userId: string, p: PrivateProfile) {
    return { userId, displayName: p.displayName, timeZone: p.timeZone, userCode: this.userCode(userId, p.codeSeed) };
  }
  private validTimeZone(value: unknown) {
    const timeZone = requiredString(value, 'Zona horaria');
    try { new Intl.DateTimeFormat('en', { timeZone }).format(this.now()); } catch { throw new HttpError(400, 'Zona horaria no válida.'); }
    return timeZone;
  }
  async previewInvite(token: string) {
    const invite = await this.db.invite(tokenHash(requiredString(token, 'Invitación', 100)));
    if (!invite || invite.expiresAt <= this.now().getTime() / 1000) throw new HttpError(404, 'Invitación caducada o no válida.');
    const challenge = await this.db.challenge(invite.challengeId);
    if (!challenge) throw new HttpError(404, 'El reto ya no existe.');
    requireOpen(challenge, this.now());
    const members = await this.db.members(challenge.id);
    return { challenge: { id: challenge.id, title: challenge.title, prize: challenge.prize ?? '', startDate: challenge.startDate, endDate: challenge.endDate, timeZone: challenge.timeZone, prizeRule: challenge.prizeRule ?? 'coordinate' },
      creator: { displayName: await this.db.profile(challenge.ownerId) ?? 'Participante' }, members: members.map(m => ({ displayName: m.displayName })) };
  }
  async ingestSteps(body: Record<string, unknown>) {
    if (Object.keys(body).some(key => !['userCode', 'steps'].includes(key))) throw new HttpError(400, 'Envía solo userCode y steps.');
    const code = typeof body.userCode === 'string' ? body.userCode : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new HttpError(401, 'Código de usuario no válido.');
    if (typeof body.steps !== 'number' || !Number.isInteger(body.steps) || body.steps < 0 || body.steps > 250000) throw new HttpError(400, 'steps no es válido.');
    const hash = tokenHash(code), identity = await this.db.stepIdentity(hash);
    if (!identity) throw new HttpError(401, 'Código de usuario no válido.');
    if (!identity.timeZone) throw new HttpError(409, 'Abre tu perfil en Ritmo para configurar tu zona horaria.');
    const now = this.now(), date = this.localDate(now, identity.timeZone), capturedAt = now.toISOString();
    const saved = await this.db.savePersonalSteps(identity.userId, { date, steps: body.steps, capturedAt, syncedAt: capturedAt }, hash, identity.timeZone);
    return { accepted: 1, date: saved.date, syncedAt: saved.syncedAt };
  }

  async handle(userId: string, method: string, path: string, body: Record<string, unknown>, source: 'manual' | 'shortcuts' = 'manual', connectionHash?: string): Promise<unknown> {
    const now = this.now();
    if (path === '/me' && method === 'GET') return this.publicOwnProfile(userId, await this.ownProfile(userId));
    if (path === '/me/activity' && method === 'GET') {
      const p = await this.ownProfile(userId);
      // Existing measurements remain visible after the product migration; overlapping challenges never add twice.
      const days = new Map((await this.db.legacyPersonalActivity(userId)).map(day => [day.date, day]));
      for (const { userId: _, timeZone: __, ...day } of await this.db.personalActivity([userId])) days.set(day.date, day);
      return { days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), timeZone: p.timeZone };
    }
    if (path === '/me/code' && method === 'POST') {
      const p = await this.ownProfile(userId), seed = randomBytes(32).toString('base64url');
      await this.db.rotateCode(userId, seed, tokenHash(this.userCode(userId, seed)));
      return this.publicOwnProfile(userId, { ...p, codeSeed: seed });
    }
    const preview = /^\/invites\/([A-Za-z0-9_-]+)$/.exec(path);
    if (preview && method === 'GET') return this.previewInvite(preview[1]!);
    if (path === '/me' && method === 'PUT') {
      await this.ownProfile(userId);
      if (body.displayName !== undefined) await this.db.saveProfile(userId, requiredString(body.displayName, 'Nombre', 40));
      if (body.timeZone !== undefined) await this.db.updateTimeZone(userId, this.validTimeZone(body.timeZone));
      return this.publicOwnProfile(userId, await this.ownProfile(userId));
    }
    if (path === '/me/data' && method === 'DELETE') {
      if (body.confirm !== 'DELETE') throw new HttpError(400, 'Confirma el borrado.');
      for (const c of await this.db.challenges(userId)) {
        if (c.ownerId === userId) await this.db.deleteChallenge(c.id);
        else { await this.db.leaderboard(c.id, userId, now); await this.db.leave(c.id, userId); }
      }
      await this.db.deleteProfile(userId);
      return { deleted: true };
    }
    if (path === '/challenges' && method === 'GET') return { challenges: await this.db.challenges(userId) };
    if (path === '/challenges' && method === 'POST') {
      if (body.shareConsent !== true) throw new HttpError(400, 'Debes aceptar compartir los totales del reto.');
      let startDate: string, endDate: string, timeZone: string;
      if (body.durationDays !== undefined) {
        if (typeof body.durationDays !== 'number' || !Number.isInteger(body.durationDays) || body.durationDays < 1 || body.durationDays > 31) throw new HttpError(400, 'El reto debe durar entre 1 y 31 días.');
        const profile = await this.ownProfile(userId);
        if (!profile.timeZone) throw new HttpError(409, 'Abre tu perfil para configurar la zona horaria.');
        timeZone = profile.timeZone; startDate = this.localDate(now, timeZone);
        endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + (body.durationDays - 1) * 86400000).toISOString().slice(0, 10);
      } else {
        startDate = dateOnly(body.startDate); endDate = dateOnly(body.endDate); timeZone = this.validTimeZone(body.timeZone);
        const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
        if (days < 0 || days > 30) throw new HttpError(400, 'El reto debe durar entre 1 y 31 días.');
      }
      const prize = body.prize === undefined ? '' : (typeof body.prize === 'string' && body.prize.trim().length <= 160 ? body.prize.trim() : undefined);
      if (prize === undefined) throw new HttpError(400, 'El premio no es válido.');
      const prizeRule = body.prizeRule ?? 'coordinate';
      if (!['coordinate', 'others', 'creator'].includes(prizeRule as string)) throw new HttpError(400, 'El acuerdo del premio no es válido.');
      const challenge = { id: randomUUID(), title: requiredString(body.title, 'Nombre del reto', 60), ownerId: userId,
        startDate, endDate, timeZone, prize, prizeRule: prizeRule as PrizeRule, createdAt: now.toISOString() };
      await this.db.createChallenge(challenge, await this.newMember(userId, now));
      return { challenge };
    }
    if (path === '/join' && method === 'POST') {
      if (body.shareConsent !== true) throw new HttpError(400, 'Debes aceptar compartir los totales del reto.');
      const hash = tokenHash(requiredString(body.token, 'Invitación', 100));
      const invite = await this.db.invite(hash);
      if (!invite || invite.expiresAt <= now.getTime() / 1000) throw new HttpError(404, 'Invitación caducada o no válida.');
      const challenge = await this.db.challenge(invite.challengeId);
      if (!challenge) throw new HttpError(404, 'El reto ya no existe.');
      if (!(await this.db.member(challenge.id, userId))) { requireOpen(challenge, now); await this.db.join(hash, await this.newMember(userId, now), Math.floor(now.getTime() / 1000)); }
      return { challenge };
    }
    const match = /^\/challenges\/([a-zA-Z0-9-]+)(?:\/(invites|activity|leaderboard|connection|membership|prize-receipt))?$/.exec(path);
    if (!match) throw new HttpError(404, 'Ruta no encontrada.');
    const id = match[1]!, resource = match[2];
    const member = await this.db.member(id, userId);
    if (!member) throw new HttpError(403, 'No perteneces a este reto.');
    const challenge = await this.db.challenge(id);
    if (!challenge) throw new HttpError(404, 'Reto no encontrado.');
    if (!resource && method === 'GET') return { challenge, members: await this.db.members(id) };
    if (resource === 'membership' && method === 'DELETE') {
      await this.db.leaderboard(id, userId, now);
      if (challenge.ownerId === userId) await this.db.deleteChallenge(id); else await this.db.leave(id, userId);
      return { removed: true };
    }
    if (resource === 'activity' && method === 'DELETE') {
      await this.db.leaderboard(id, userId, now);
      await this.db.clearActivity(id, userId); return { deleted: true };
    }
    if (resource === 'connection') {
      if (method === 'GET') {
        const c = await this.db.activeConnection(id, userId);
        return { active: Boolean(c && c.expiresAt > now.getTime() / 1000), expiresAt: c?.expiresAt ?? null };
      }
      if (method === 'DELETE') { await this.db.revokeConnection(id, userId); return { revoked: true }; }
      if (method === 'POST') {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = Math.floor(now.getTime() / 1000) + 30 * 86400;
        await this.db.saveConnection({ challengeId: id, userId, hash: tokenHash(token), expiresAt });
        return { token, expiresAt, timeZone: challenge.timeZone };
      }
    }
    if (resource === 'prize-receipt' && method === 'POST') return { result: await this.db.receivePrize(id, userId, now) };
    if (resource === 'invites' && method === 'POST') {
      requireOpen(challenge, now);
      if (challenge.ownerId !== userId) throw new HttpError(403, 'Solo quien creó el reto puede invitar.');
      const token = randomBytes(24).toString('base64url');
      const expiresAt = Math.floor(now.getTime() / 1000) + 7 * 86400;
      await this.db.saveInvite(tokenHash(token), { challengeId: id, expiresAt });
      return { token, expiresAt };
    }
    if (resource === 'activity' && method === 'PUT') {
      requireOpen(challenge, now);
      if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > 31) throw new HttpError(400, 'Envía entre 1 y 31 días.');
      const seen = new Set<string>();
      const days: Activity[] = body.days.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new HttpError(400, 'Actividad no válida.');
        const input = item as Record<string, unknown>, date = dateOnly(input.date);
        if (date < challenge.startDate || date > challenge.endDate || seen.has(date)) throw new HttpError(400, 'Fecha fuera del reto o duplicada.');
        seen.add(date);
        const capturedAt = instant(input.capturedAt);
        if (Date.parse(capturedAt) > now.getTime() + 300_000 || date > this.localDate(now, challenge.timeZone)) throw new HttpError(400, 'No se aceptan datos futuros.');
        for (const [key, max] of [['steps', 250000], ['workoutSeconds', 93600]] as const) {
          const value = input[key];
          if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max)) throw new HttpError(400, `${key} no es válido.`);
        }
        return { date, steps: input.steps as number | null, workoutSeconds: input.workoutSeconds as number | null,
          capturedAt, syncedAt: now.toISOString(), source };
      });
      await this.db.saveActivity(id, userId, days, connectionHash);
      return { accepted: days.length, syncedAt: now.toISOString() };
    }
    if (resource === 'leaderboard' && method === 'GET') return this.db.leaderboard(id, userId, now);
    throw new HttpError(404, 'Ruta no encontrada.');
  }
  async ingest(token: string, body: Record<string, unknown>) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError(401, 'Clave de Atajos no válida.');
    const c = await this.db.connection(tokenHash(token));
    if (!c || c.expiresAt <= this.now().getTime() / 1000) throw new HttpError(401, 'Conexión caducada o revocada.');
    const challenge = await this.db.challenge(c.challengeId);
    if (!challenge) throw new HttpError(403, 'Reto no disponible.');
    if (body.timeZone !== challenge.timeZone) throw new HttpError(400, 'La zona horaria debe coincidir con el reto.');
    return this.handle(c.userId, 'PUT', `/challenges/${c.challengeId}/activity`, { days: [{ date: body.date, steps: body.steps,
      workoutSeconds: body.workoutSeconds ?? null, capturedAt: body.capturedAt ?? this.now().toISOString() }] }, 'shortcuts', c.hash);
  }
  private async newMember(userId: string, date: Date) {
    return { userId, displayName: await this.db.profile(userId) ?? 'Participante', joinedAt: date.toISOString(), shareConsentAt: date.toISOString() };
  }
  private localDate(date: Date, timeZone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
}
