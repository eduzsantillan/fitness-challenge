import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Activity, HttpError, Repository, dateOnly, instant, requiredString } from './model.js';

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export class ChallengeService {
  constructor(private db: Repository, private now = () => new Date()) {}

  async handle(userId: string, method: string, path: string, body: Record<string, unknown>, source: 'manual' | 'shortcuts' = 'manual', connectionHash?: string): Promise<unknown> {
    const now = this.now();
    if (path === '/me' && method === 'GET') return { userId, displayName: await this.db.profile(userId) ?? 'Participante' };
    if (path === '/me' && method === 'PUT') {
      const displayName = requiredString(body.displayName, 'Nombre', 40);
      await this.db.saveProfile(userId, displayName);
      return { userId, displayName };
    }
    if (path === '/me/data' && method === 'DELETE') {
      if (body.confirm !== 'DELETE') throw new HttpError(400, 'Confirma el borrado.');
      for (const c of await this.db.challenges(userId)) {
        if (c.ownerId === userId) await this.db.deleteChallenge(c.id);
        else await this.db.leave(c.id, userId);
      }
      await this.db.deleteProfile(userId);
      return { deleted: true };
    }
    if (path === '/challenges' && method === 'GET') return { challenges: await this.db.challenges(userId) };
    if (path === '/challenges' && method === 'POST') {
      if (body.shareConsent !== true) throw new HttpError(400, 'Debes aceptar compartir los totales del reto.');
      const startDate = dateOnly(body.startDate), endDate = dateOnly(body.endDate);
      const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
      if (days < 0 || days > 30) throw new HttpError(400, 'El reto debe durar entre 1 y 31 días.');
      const timeZone = requiredString(body.timeZone, 'Zona horaria');
      try { new Intl.DateTimeFormat('en', { timeZone }).format(now); } catch { throw new HttpError(400, 'Zona horaria no válida.'); }
      const challenge = { id: randomUUID(), title: requiredString(body.title, 'Nombre del reto', 60), ownerId: userId,
        startDate, endDate, timeZone, createdAt: now.toISOString() };
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
      if (!(await this.db.member(challenge.id, userId))) await this.db.join(hash, await this.newMember(userId, now), Math.floor(now.getTime() / 1000));
      return { challenge };
    }
    const match = /^\/challenges\/([a-zA-Z0-9-]+)(?:\/(invites|activity|leaderboard|connection|membership))?$/.exec(path);
    if (!match) throw new HttpError(404, 'Ruta no encontrada.');
    const id = match[1]!, resource = match[2];
    const member = await this.db.member(id, userId);
    if (!member) throw new HttpError(403, 'No perteneces a este reto.');
    const challenge = await this.db.challenge(id);
    if (!challenge) throw new HttpError(404, 'Reto no encontrado.');
    if (!resource && method === 'GET') return { challenge, members: await this.db.members(id) };
    if (resource === 'membership' && method === 'DELETE') {
      if (challenge.ownerId === userId) await this.db.deleteChallenge(id); else await this.db.leave(id, userId);
      return { removed: true };
    }
    if (resource === 'activity' && method === 'DELETE') {
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
    if (resource === 'invites' && method === 'POST') {
      if (challenge.ownerId !== userId) throw new HttpError(403, 'Solo quien creó el reto puede invitar.');
      const token = randomBytes(24).toString('base64url');
      const expiresAt = Math.floor(now.getTime() / 1000) + 7 * 86400;
      await this.db.saveInvite(tokenHash(token), { challengeId: id, expiresAt });
      return { token, expiresAt };
    }
    if (resource === 'activity' && method === 'PUT') {
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
    if (resource === 'leaderboard' && method === 'GET') {
      const members = await this.db.members(id), activity = await this.db.activity(id);
      const rows = members.map(person => {
        const days = activity.filter(row => row.userId === person.userId && row.date >= challenge.startDate && row.date <= challenge.endDate);
        const sum = (key: 'steps' | 'workoutSeconds') => {
          const values = days.flatMap(day => day[key] === null ? [] : [day[key]!]);
          return values.length ? values.reduce((a, b) => a + b, 0) : null;
        };
        return { userId: person.userId, displayName: person.displayName, steps: sum('steps'), workoutSeconds: sum('workoutSeconds'),
          days: days.map(({ userId: _, ...day }) => day).sort((a, b) => a.date.localeCompare(b.date)) };
      });
      return { challenge, rows };
    }
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
