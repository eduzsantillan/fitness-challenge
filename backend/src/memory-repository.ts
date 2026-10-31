import { Activity, Challenge, Connection, HttpError, Invite, Member, Repository } from './model.js';
export class MemoryRepository implements Repository {
  private profiles = new Map<string, string>();
  private groups = new Map<string, Challenge>();
  private people = new Map<string, Map<string, Member>>();
  private invites = new Map<string, Invite>();
  private days = new Map<string, Activity & { userId: string }>();
  private connections = new Map<string, Connection>();
  async profile(userId: string) { return this.profiles.get(userId); }
  async saveProfile(userId: string, name: string) {
    this.profiles.set(userId, name);
    for (const group of this.people.values()) { const member = group.get(userId); if (member) member.displayName = name; }
  }
  async createChallenge(c: Challenge, m: Member) { this.groups.set(c.id, c); this.people.set(c.id, new Map([[m.userId, m]])); }
  async challenge(id: string) { return this.groups.get(id); }
  async challenges(userId: string) { return [...this.groups.values()].filter(c => this.people.get(c.id)?.has(userId)); }
  async member(id: string, userId: string) { return this.people.get(id)?.get(userId); }
  async members(id: string) { return [...this.people.get(id)?.values() ?? []]; }
  async saveInvite(hash: string, invite: Invite) { this.invites.set(hash, invite); }
  async invite(hash: string) { return this.invites.get(hash); }
  async join(hash: string, member: Member, now: number) {
    const invite = this.invites.get(hash);
    if (!invite || invite.expiresAt <= now) throw new HttpError(404, 'Invitación caducada.');
    this.people.get(invite.challengeId)?.set(member.userId, member);
  }
  async saveActivity(id: string, userId: string, days: Activity[], connectionHash?: string) {
    if (!this.people.get(id)?.has(userId) || !this.groups.has(id)) throw new HttpError(403, 'No perteneces al reto.');
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
    await this.revokeConnection(id, userId);
    for (const [key, day] of this.days) if (key.startsWith(`${id}/`) && day.userId === userId) this.days.delete(key);
  }
  async leave(id: string, userId: string) { this.people.get(id)?.delete(userId); await this.clearActivity(id, userId); }
  async deleteChallenge(id: string) {
    for (const m of await this.members(id)) await this.leave(id, m.userId);
    this.groups.delete(id); this.people.delete(id);
    for (const [hash, invite] of this.invites) if (invite.challengeId === id) this.invites.delete(hash);
  }
  async deleteProfile(userId: string) { this.profiles.delete(userId); }
}
