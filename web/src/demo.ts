import type { Activity, Board, Challenge, Client, Profile, Row } from './types';
import { addDays, dateKey, sum, week } from './dates';
import { dateOnly, requiredString } from '../../backend/src/model.js';
const today = dateKey();
const sampleDays = (steps: number[], minutes: number[]): Activity[] => week(today).filter(date => date <= today).map((date, i) => ({ date,
  steps: steps[i] ?? 0, workoutSeconds: (minutes[i] ?? 0) * 60, capturedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), source: 'shortcuts' }));
const challenge: Challenge = { id: 'demo-week', title: 'Una semana en movimiento', ownerId: 'demo-you', startDate: week(today)[0]!, endDate: week(today)[6]!,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, createdAt: new Date().toISOString() };
export class DemoClient implements Client {
  profile: Profile = { userId: 'demo-you', displayName: 'Tú' };
  boards = new Map<string, Board>([[challenge.id, { challenge, rows: [
    { userId: 'demo-you', displayName: 'Tú', steps: null, workoutSeconds: null, days: sampleDays([8340, 10250, 7420, 11680, 8642, 9130, 6500], [35, 48, 0, 62, 42, 30, 25]) },
    { userId: 'demo-alex', displayName: 'Alex', steps: null, workoutSeconds: null, days: sampleDays([7200, 9800, 8100, 10200, 7890, 8500, 6100], [40, 30, 45, 50, 30, 35, 20]) }
  ] }]]);
  async request<T>(path: string, method = 'GET', raw?: unknown): Promise<T> {
    const body = (raw ?? {}) as Record<string, unknown>;
    if (path === '/me') { if (method === 'PUT') { this.profile.displayName = requiredString(body.displayName, 'Nombre', 40); for (const b of this.boards.values()) b.rows.find(r => r.userId === this.profile.userId)!.displayName = this.profile.displayName; } return this.profile as T; }
    if (path === '/me/data' && method === 'DELETE') { this.boards.clear(); this.profile = { userId: 'demo-you', displayName: 'Tú' }; return { deleted: true } as T; }
    if (path === '/challenges') {
      if (method === 'GET') return { challenges: [...this.boards.values()].map(b => b.challenge) } as T;
      if (body.shareConsent !== true) throw new Error('Debes aceptar compartir los totales del reto.');
      const start = dateOnly(body.startDate), end = dateOnly(body.endDate);
      const span = (Date.parse(end) - Date.parse(start)) / 86400000;
      if (span < 0 || span > 30) throw new Error('El reto debe durar entre 1 y 31 días.');
      body.title = requiredString(body.title, 'Nombre del reto', 60);
      try { new Intl.DateTimeFormat('en', { timeZone: String(body.timeZone) }); } catch { throw new Error('Zona horaria no válida.'); }
      const c = { ...body, id: crypto.randomUUID(), ownerId: this.profile.userId, createdAt: new Date().toISOString() } as Challenge;
      this.boards.set(c.id, { challenge: c, rows: [{ ...this.profile, steps: null, workoutSeconds: null, days: [] }] }); return { challenge: c } as T;
    }
    if (path === '/join') {
      if (body.shareConsent !== true) throw new Error('Debes aceptar compartir los totales.');
      const board = this.boards.get(String(body.token).replace(/^DEMO-/, ''));
      if (!board) throw new Error('En la demo solo funcionan códigos creados en esta misma pestaña.');
      return { challenge: board.challenge } as T;
    }
    const [, , id, resource] = path.split('/'), board = this.boards.get(id ?? '');
    if (!board) throw new Error('No se encontró el reto.');
    if (resource === 'leaderboard') {
      return { ...board, rows: board.rows.map(row => ({ ...row, steps: sum(row.days, 'steps'), workoutSeconds: sum(row.days, 'workoutSeconds') })) } as T;
    }
    if (resource === 'invites') return { token: `DEMO-${id}`, expiresAt: Date.now() / 1000 + 86400 } as T;
    if (resource === 'connection') {
      if (method === 'POST') throw new Error('Las claves de Atajos requieren el backend real. La demo no recibe datos de Salud.');
      return { active: false, expiresAt: null } as T;
    }
    if (resource === 'membership' && method === 'DELETE') { this.boards.delete(id!); return { removed: true } as T; }
    if (resource === 'activity') {
      const row = board.rows.find(r => r.userId === this.profile.userId)!;
      if (method === 'DELETE') row.days = [];
      else for (const day of body.days as Activity[]) {
        dateOnly(day.date);
        if (day.date < board.challenge.startDate || day.date > board.challenge.endDate || day.date > dateKey(new Date(), board.challenge.timeZone)) throw new Error('Fecha fuera del reto o futura.');
        if ([day.steps, day.workoutSeconds].some(value => value !== null && (!Number.isInteger(value) || value < 0))) throw new Error('Los totales deben ser números enteros positivos o cero.');
        row.days = row.days.filter(d => d.date !== day.date); row.days.push({ ...day, syncedAt: new Date().toISOString(), source: 'manual' });
      }
      return { accepted: 1 } as T;
    }
    return { challenge: board.challenge } as T;
  }
}
