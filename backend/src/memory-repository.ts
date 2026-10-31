import { Activity, Challenge, Connection, FrozenResult, HttpError, Invite, Member, PersonalSteps, PrivateProfile, Repository } from './model.js';
import { boardRows, closingInstant, confirmReceipt, finalizeResult, isClosed, redactResult, requireOpen, resultMetadata } from './completion.js';
export class MemoryRepository implements Repository {
  private profiles = new Map<string, string>();
  private settings = new Map<string, PrivateProfile>();
  private personal = new Map<string, PersonalSteps & { userId: string }>();
  private history: (PersonalSteps & { userId: string; timeZone: string })[] = [];
  private results = new Map<string, FrozenResult>();
  private legacyArchive = new Map<string, PersonalSteps & { userId: string; sourceChallengeId: string }>();
  private groups = new Map<string, Challenge>();
  private people = new Map<string, Map<string, Member>>();
  private invites = new Map<string, Invite>();
  private days = new Map<string, Activity & { userId: string }>();
  private connections = new Map<string, Connection>();
  async ensurePrivateProfile(userId: string, codeSeed: string, codeHash: string) {
    if (!this.settings.has(userId)) this.settings.set(userId, { displayName: this.profiles.get(userId) ?? 'Participante', timeZone: null, codeSeed, codeHash });
    return { ...this.settings.get(userId)! };
  }
  async updateTimeZone(userId: string, timeZone: string) { this.settings.get(userId)!.timeZone = timeZone; }
  async rotateCode(userId: string, codeSeed: string, codeHash: string) { Object.assign(this.settings.get(userId)!, { codeSeed, codeHash }); }
  async repairCode(userId: string, previousHash: string, codeSeed: string, codeHash: string) {
    const p = this.settings.get(userId);
    if (!p) throw new HttpError(401, 'Inicia sesión.');
    if (p.codeHash === previousHash) Object.assign(p, { codeSeed, codeHash });
    return { ...p };
  }
  private legacyCanonical(userId: string) {
    const rows = [...this.days].filter(([, row]) => row.userId === userId && row.steps !== null)
      .map(([key, row]) => ({ date: row.date, steps: row.steps!, capturedAt: row.capturedAt, syncedAt: row.syncedAt, userId, sourceChallengeId: key.split('/')[0]! }));
    rows.push(...[...this.legacyArchive.values()].filter(row => row.userId === userId));
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows.sort((a, b) => a.sourceChallengeId.localeCompare(b.sourceChallengeId))) {
      const old = latest.get(row.date);
      if (!old || row.capturedAt > old.capturedAt || (row.capturedAt === old.capturedAt && row.syncedAt > old.syncedAt)) latest.set(row.date, row);
    }
    return [...latest.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  async legacyPersonalActivity(userId: string) {
    return this.legacyCanonical(userId).map(({ userId: _, sourceChallengeId: __, ...day }) => day);
  }
  private preserveLegacy(userIds: string[]) {
    for (const userId of [...new Set(userIds)].sort()) for (const day of this.legacyCanonical(userId)) this.legacyArchive.set(`${userId}/${day.date}`, { ...day });
  }
  async stepIdentity(codeHash: string) {
    const identity = [...this.settings].find(([, p]) => p.codeHash === codeHash);
    return identity ? { userId: identity[0], timeZone: identity[1].timeZone } : undefined;
  }
  async personalActivity(userIds: string[]) { return [...this.personal.values()].filter(d => userIds.includes(d.userId)).map(d => ({ ...d, timeZone: this.settings.get(d.userId)?.timeZone ?? null })); }
  async savePersonalSteps(userId: string, day: PersonalSteps, codeHash: string, timeZone: string) {
    const profile = this.settings.get(userId);
    if (profile?.codeHash !== codeHash) throw new HttpError(401, 'Código de usuario no válido.');
    if (profile.timeZone !== timeZone) throw new HttpError(409, 'La zona horaria cambió. Vuelve a enviar los pasos.');
    const key = `${userId}/${day.date}`, previous = this.personal.get(key);
    if (!previous || previous.capturedAt <= day.capturedAt) { this.personal.set(key, { ...day, userId }); this.history.push({ ...day, userId, timeZone }); }
    return { ...day };
  }
  async profile(userId: string) { return this.profiles.get(userId); }
  async saveProfile(userId: string, name: string) {
    this.profiles.set(userId, name);
    const settings = this.settings.get(userId); if (settings) settings.displayName = name;
    for (const group of this.people.values()) { const member = group.get(userId); if (member) member.displayName = name; }
  }
  async createChallenge(c: Challenge, m: Member) { this.groups.set(c.id, c); this.people.set(c.id, new Map([[m.userId, m]])); }
  async challenge(id: string) { return this.groups.get(id); }
  async challenges(userId: string) { return [...this.groups.values()].filter(c => this.people.get(c.id)?.has(userId)); }
  async leaderboard(id: string, userId: string, now: Date) {
    if (!await this.member(id, userId)) throw new HttpError(403, 'No perteneces al reto.');
    const challenge = await this.challenge(id); if (!challenge) throw new HttpError(404, 'Reto no encontrado.');
    let frozen = this.results.get(id);
    if (!frozen && isClosed(challenge, now)) {
      frozen = finalizeResult(challenge, boardRows(challenge, await this.members(id), await this.activity(id), this.history, closingInstant(challenge)), now);
      this.results.set(id, frozen);
    }
    return structuredClone({ challenge, rows: frozen?.rows ?? boardRows(challenge, await this.members(id), await this.activity(id), await this.personalActivity((await this.members(id)).map(m => m.userId))), result: frozen ? resultMetadata(frozen) : null });
  }
  async receivePrize(id: string, userId: string, now: Date) {
    await this.leaderboard(id, userId, now);
    const frozen = confirmReceipt((await this.challenge(id))!, this.results.get(id) ?? null, userId, now);
    this.results.set(id, frozen); return structuredClone(resultMetadata(frozen));
  }
  async member(id: string, userId: string) { return this.people.get(id)?.get(userId); }
  async members(id: string) { return [...this.people.get(id)?.values() ?? []]; }
  async saveInvite(hash: string, invite: Invite) { this.invites.set(hash, invite); }
  async invite(hash: string) { return this.invites.get(hash); }
  async join(hash: string, member: Member, now: number) {
    const invite = this.invites.get(hash);
    if (!invite || invite.expiresAt <= now) throw new HttpError(404, 'Invitación caducada.');
    requireOpen(this.groups.get(invite.challengeId)!, new Date(now * 1000));
    this.people.get(invite.challengeId)?.set(member.userId, member);
  }
  async saveActivity(id: string, userId: string, days: Activity[], connectionHash?: string) {
    if (!this.people.get(id)?.has(userId) || !this.groups.has(id)) throw new HttpError(403, 'No perteneces al reto.');
    if (this.results.has(id)) throw new HttpError(409, 'El resultado del reto ya está cerrado.');
    for (const day of days) requireOpen(this.groups.get(id)!, new Date(day.syncedAt));
    if (connectionHash && (await this.activeConnection(id, userId))?.hash !== connectionHash) throw new HttpError(401, 'Conexión revocada.');
    for (const day of days) {
      const key = `${id}/${userId}/${day.date}`, previous = this.days.get(key);
      const preserve = day.source === 'shortcuts' && day.workoutSeconds === null && previous?.workoutSeconds != null;
      if (!previous || previous.capturedAt <= day.capturedAt) this.days.set(key, { ...day, userId, ...(preserve ? { workoutSeconds: previous.workoutSeconds, source: 'mixed' } : {}) });
    }
  }
  async activity(id: string) { return [...this.days.entries()].filter(([key]) => key.startsWith(`${id}/`)).map(([, value]) => value); }
  async saveConnection(connection: Connection) {
    await this.revokeConnection(connection.challengeId, connection.userId);
    this.connections.set(connection.hash, connection);
  }
  async connection(hash: string) { return this.connections.get(hash); }
  async activeConnection(id: string, userId: string) { return [...this.connections.values()].find(c => c.challengeId === id && c.userId === userId); }
  async revokeConnection(id: string, userId: string) {
    for (const [hash, c] of this.connections) if (c.challengeId === id && c.userId === userId) this.connections.delete(hash);
  }
  async clearActivity(id: string, userId: string) {
    const result = this.results.get(id); if (result) this.results.set(id, redactResult(result, userId));
    await this.revokeConnection(id, userId);
    for (const [key, day] of this.days) if (key.startsWith(`${id}/`) && day.userId === userId) this.days.delete(key);
  }
  async leave(id: string, userId: string) { this.preserveLegacy([userId]); const result = this.results.get(id); if (result) this.results.set(id, redactResult(result, userId)); this.people.get(id)?.delete(userId); await this.clearActivity(id, userId); }
  async deleteChallenge(id: string) {
    for (const m of await this.members(id)) await this.leave(id, m.userId);
    this.groups.delete(id); this.people.delete(id); this.results.delete(id);
    for (const [hash, invite] of this.invites) if (invite.challengeId === id) this.invites.delete(hash);
  }
  async deleteProfile(userId: string) {
    this.profiles.delete(userId); this.settings.delete(userId);
    for (const [key, d] of this.personal) if (d.userId === userId) this.personal.delete(key);
    this.history = this.history.filter(day => day.userId !== userId);
    for (const [id, result] of this.results) this.results.set(id, redactResult(result, userId));
    for (const [key, d] of this.legacyArchive) if (d.userId === userId) this.legacyArchive.delete(key);
  }
}
