import type { Activity, Board, Challenge, Client, InvitePreview, Profile, Row } from './types';
import { addDays, dateKey, sum, week } from './dates';
import { dateOnly, requiredString } from '../../backend/src/model.js';

export const DEMO_USER_CODE = 'DEMO-NO-ENVIA-DATOS';
const DEMO_USER_ID = 'demo-you';
const copy = <T>(value: T): T => structuredClone(value);

/** Fictional sample data, held in this instance only. Never fetches, persists, or falls back from real API errors. */
export class DemoClient implements Client {
  profile: Profile;
  boards = new Map<string, Board>();
  private personalDays = new Map<string, Activity[]>();
  private joinedDates = new Map<string, Map<string, string>>();

  constructor(private readonly now = () => new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    this.profile = { userId: DEMO_USER_ID, displayName: 'Tú', userCode: DEMO_USER_CODE, timeZone: this.validTimeZone(timeZone) };
    const today = this.today(), weekDates = week(today), monthStart = `${today.slice(0, 7)}-01`;
    const nextMonth = new Date(`${monthStart}T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const monthEnd = addDays(nextMonth.toISOString().slice(0, 10), -1);
    const historyStart = [weekDates[0]!, monthStart, addDays(today, -7)].sort()[0]!;
    this.personalDays.set(DEMO_USER_ID, this.sampleDays(historyStart, today, false));
    this.personalDays.set('demo-alex', this.sampleDays(historyStart, today, true));
    const createdAt = this.now().toISOString();
    for (const challenge of [
      { id: 'demo-week', title: 'El pique de la semana', ownerId: DEMO_USER_ID, startDate: weekDates[0]!, endDate: weekDates[6]!, prize: 'Un brunch para dos' },
      { id: 'demo-month', title: 'Pasitos y cafecitos', ownerId: 'demo-alex', startDate: monthStart, endDate: monthEnd, prize: 'Alguien invita los cafés' },
      { id: 'demo-finish', title: 'El brunch se camina', ownerId: DEMO_USER_ID, startDate: addDays(today, -7), endDate: addDays(today, -1), prize: 'Un brunch y café para dos', prizeRule: 'others' as const },
    ]) {
      const sampleChallenge: Challenge = { ...challenge, timeZone: this.profile.timeZone!, createdAt };
      this.boards.set(challenge.id, { challenge: sampleChallenge, rows: [this.emptyRow(DEMO_USER_ID, 'Tú'), this.emptyRow('demo-alex', 'Alex')] });
      this.joinedDates.set(challenge.id, new Map([[DEMO_USER_ID, challenge.startDate], ['demo-alex', challenge.startDate]]));
    }
    this.syncBoards();
    for (const board of this.boards.values()) this.finalize(board);
  }

  private today() { return dateKey(this.now(), this.profile.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone); }
  private validTimeZone(value: unknown) {
    const zone = requiredString(value, 'Zona horaria');
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(this.now()); } catch { throw new Error('Zona horaria no válida.'); }
    return zone;
  }
  private emptyRow(userId: string, displayName: string): Row { return { userId, displayName, steps: null, workoutSeconds: null, days: [] }; }
  private sampleDays(start: string, end: string, other: boolean): Activity[] {
    const result: Activity[] = [], now = this.now().toISOString();
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const index = new Date(`${date}T12:00:00Z`).getUTCDate();
      const steps = 5600 + ((index * 577 + (other ? 731 : 0)) % 4300) + (other ? -500 : 0);
      result.push({ date, steps, workoutSeconds: null, capturedAt: now, syncedAt: now, source: 'manual' });
    }
    return result;
  }
  private syncBoards() {
    for (const [id, board] of this.boards) {
      if (board.result) continue;
      for (const row of board.rows) {
        const joined = this.joinedDates.get(id)?.get(row.userId) ?? board.challenge.startDate;
        row.days = copy((this.personalDays.get(row.userId) ?? []).filter(day => day.date >= board.challenge.startDate && day.date >= joined && day.date <= board.challenge.endDate));
        row.steps = sum(row.days, 'steps'); row.workoutSeconds = sum(row.days, 'workoutSeconds');
        if (row.userId === this.profile.userId) row.displayName = this.profile.displayName;
      }
    }
  }
  private closed(board: Board) { return dateKey(this.now(), board.challenge.timeZone) > board.challenge.endDate; }
  private finalize(board: Board) {
    if (board.result || !this.closed(board)) return;
    const max = Math.max(0, ...board.rows.map(r => r.steps ?? 0));
    const missing = board.rows.some(r => r.steps === null), leaders = board.rows.filter(r => r.steps === max).map(r => r.userId);
    const outcome = board.rows.length < 2 ? 'solo' : missing ? 'incomplete' : max === 0 ? 'no_data' : leaders.length > 1 ? 'tie' : 'winner';
    const winnerUserIds = outcome === 'winner' || outcome === 'tie' ? leaders : [];
    const prizeRule = board.challenge.prizeRule || 'coordinate';
    const payerUserIds = outcome !== 'winner' || !board.challenge.prize ? [] : prizeRule === 'others' ? board.rows.filter(r => !winnerUserIds.includes(r.userId)).map(r => r.userId) : prizeRule === 'creator' && !winnerUserIds.includes(board.challenge.ownerId) ? [board.challenge.ownerId] : [];
    board.result = { finalizedAt: this.now().toISOString(), outcome, winnerUserIds, hasMissingData: missing, prizeRule, payerUserIds, receivedAt: null, receivedBy: null };
  }
  private requireOpen(board: Board) { if (this.closed(board) || board.result) throw new Error('Este reto ya terminó. Su resultado no admite cambios.'); }
  private board(id: string) {
    const board = this.boards.get(id);
    if (!board) throw new Error('No se encontró el reto de ejemplo. La demo solo vive en esta pestaña.');
    return board;
  }
  private inviteBoard(token: unknown) {
    if (typeof token !== 'string' || !token.startsWith('DEMO-')) throw new Error('En la demo solo funcionan enlaces de ejemplo de esta pestaña.');
    return this.board(token.slice(5));
  }
  private preview(board: Board): InvitePreview {
    const { id, title, prize, startDate, endDate, timeZone, prizeRule } = board.challenge;
    return { challenge: { id, title, prize, startDate, endDate, timeZone, prizeRule },
      creator: { displayName: board.rows.find(row => row.userId === board.challenge.ownerId)?.displayName ?? 'Participante de ejemplo' },
      members: board.rows.map(row => ({ displayName: row.displayName })) };
  }

  async request<T>(path: string, method = 'GET', raw?: unknown): Promise<T> {
    const body = (raw ?? {}) as Record<string, unknown>;
    if (path === '/me' && (method === 'GET' || method === 'PUT')) {
      if (method === 'PUT') {
        // Validate both values first so a rejected edit cannot partially mutate the demo.
        const name = body.displayName === undefined ? this.profile.displayName : requiredString(body.displayName, 'Nombre', 40);
        const zone = body.timeZone === undefined ? this.profile.timeZone : this.validTimeZone(body.timeZone);
        this.profile = { ...this.profile, displayName: name, timeZone: zone };
        this.syncBoards();
      }
      return copy(this.profile) as T;
    }
    if (path === '/me/activity' && method === 'GET') {
      return copy({ days: this.personalDays.get(this.profile.userId) ?? [], timeZone: this.profile.timeZone }) as T;
    }
    if (path === '/me/code' && method === 'POST') throw new Error('Este código es de ejemplo. La demo no genera códigos reales ni recibe datos de Salud.');
    if ((path === '/steps' || path === '/shortcuts') && method === 'POST') throw new Error('La demo no recibe datos reales de Salud. Inicia sesión en tu cuenta para sincronizar.');
    if (path === '/me/data' && method === 'DELETE') {
      if (body.confirm !== 'DELETE') throw new Error('Confirma el borrado.');
      this.boards.clear(); this.joinedDates.clear(); this.personalDays.clear();
      return { deleted: true } as T;
    }
    const preview = /^\/invites\/([^/]+)$/.exec(path);
    if (preview && method === 'GET') { const board = this.inviteBoard(preview[1]); this.requireOpen(board); return copy(this.preview(board)) as T; }
    if (path === '/challenges' && method === 'GET') return copy({ challenges: [...this.boards.values()].map(board => board.challenge) }) as T;
    if (path === '/challenges' && method === 'POST') {
      if (body.shareConsent !== true) throw new Error('Debes aceptar compartir los totales del reto.');
      let startDate: string, endDate: string, timeZone: string;
      if (body.durationDays !== undefined) {
        if (typeof body.durationDays !== 'number' || !Number.isInteger(body.durationDays) || body.durationDays < 1 || body.durationDays > 31) throw new Error('El reto debe durar entre 1 y 31 días.');
        startDate = this.today(); endDate = addDays(startDate, body.durationDays - 1); timeZone = this.profile.timeZone!;
      } else {
        startDate = dateOnly(body.startDate); endDate = dateOnly(body.endDate); timeZone = this.validTimeZone(body.timeZone);
        const span = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
        if (span < 0 || span > 30) throw new Error('El reto debe durar entre 1 y 31 días.');
      }
      const prize = body.prize === undefined ? '' : typeof body.prize === 'string' && body.prize.trim().length <= 160 ? body.prize.trim() : undefined;
      if (prize === undefined) throw new Error('El premio no es válido.');
      const prizeRule = body.prizeRule ?? 'coordinate';
      if (!['coordinate', 'others', 'creator'].includes(String(prizeRule))) throw new Error('El acuerdo del premio no es válido.');
      const challenge: Challenge = { prizeRule: prizeRule as 'coordinate' | 'others' | 'creator', id: crypto.randomUUID(), ownerId: this.profile.userId, title: requiredString(body.title, 'Nombre del reto', 60),
        startDate, endDate, timeZone, prize, createdAt: this.now().toISOString() };
      this.boards.set(challenge.id, { challenge, rows: [this.emptyRow(this.profile.userId, this.profile.displayName)] });
      this.joinedDates.set(challenge.id, new Map([[this.profile.userId, this.today()]]));
      this.syncBoards();
      return copy({ challenge }) as T;
    }
    if (path === '/join' && method === 'POST') {
      if (body.shareConsent !== true) throw new Error('Debes aceptar compartir los totales del reto.');
      const board = this.inviteBoard(body.token);
      if (!board.rows.some(row => row.userId === this.profile.userId)) {
        this.requireOpen(board);
        board.rows.push(this.emptyRow(this.profile.userId, this.profile.displayName));
        const dates = this.joinedDates.get(board.challenge.id) ?? new Map<string, string>();
        dates.set(this.profile.userId, this.today()); this.joinedDates.set(board.challenge.id, dates);
      }
      this.syncBoards(); return copy({ challenge: board.challenge }) as T;
    }
    const match = /^\/challenges\/([A-Za-z0-9-]+)(?:\/(leaderboard|invites|membership|connection|activity|prize-receipt))?$/.exec(path);
    if (!match) throw new Error('Ruta no disponible en esta demostración.');
    const id = match[1]!, resource = match[2], board = this.board(id);
    if (resource === 'leaderboard' && method === 'GET') { this.syncBoards(); this.finalize(board); return copy(board) as T; }
    if (resource === 'prize-receipt' && method === 'POST') {
      this.syncBoards(); this.finalize(board);
      if (!board.result) throw new Error('El premio se confirma cuando termina el reto.');
      if (board.result.outcome !== 'winner' || !board.result.winnerUserIds.includes(this.profile.userId) || !board.challenge.prize) throw new Error('Solo quien ganó puede confirmar que recibió el premio.');
      if (!board.result.receivedAt) board.result = { ...board.result, receivedAt: this.now().toISOString(), receivedBy: this.profile.userId };
      return copy({ result: board.result }) as T;
    }
    if (resource === 'invites' && method === 'POST') {
      this.requireOpen(board);
      if (board.challenge.ownerId !== this.profile.userId) throw new Error('Solo quien creó el reto puede invitar.');
      return { token: `DEMO-${id}`, expiresAt: this.now().getTime() / 1000 + 86400 } as T;
    }
    if (resource === 'connection') {
      if (method === 'POST') throw new Error('La demo no genera claves ni recibe datos de Salud.');
      if (method === 'GET') return { active: false, expiresAt: null } as T;
      if (method === 'DELETE') return { revoked: true } as T;
    }
    if (resource === 'membership' && method === 'DELETE') { this.boards.delete(id); this.joinedDates.delete(id); return { removed: true } as T; }
    if (resource === 'activity' && (method === 'PUT' || method === 'DELETE')) {
      const days = this.personalDays.get(this.profile.userId) ?? [];
      if (method === 'DELETE') this.personalDays.set(this.profile.userId, days.filter(day => day.date < board.challenge.startDate || day.date > board.challenge.endDate));
      else {
        this.requireOpen(board);
        if (!Array.isArray(body.days) || body.days.length < 1 || body.days.length > 31) throw new Error('Envía entre 1 y 31 días.');
        const seen = new Set<string>();
        const accepted: Activity[] = body.days.map((raw: unknown) => {
          if (!raw || typeof raw !== 'object') throw new Error('Actividad no válida.');
          const value = raw as Record<string, unknown>, date = dateOnly(value.date);
          if (seen.has(date) || date < board.challenge.startDate || date > board.challenge.endDate || date > dateKey(this.now(), board.challenge.timeZone)) throw new Error('Fecha fuera del reto, duplicada o futura.');
          seen.add(date);
          for (const [key, max] of [['steps', 250000], ['workoutSeconds', 93600]] as const) {
            const amount = value[key];
            if (amount !== null && (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || amount > max)) throw new Error('Los totales deben ser números enteros positivos o cero.');
          }
          const now = this.now().toISOString();
          return { date, steps: value.steps as number | null, workoutSeconds: value.workoutSeconds as number | null,
            capturedAt: now, syncedAt: now, source: 'manual' };
        });
        this.personalDays.set(this.profile.userId, [...days.filter(day => !seen.has(day.date)), ...accepted].sort((a, b) => a.date.localeCompare(b.date)));
      }
      this.syncBoards(); return { accepted: method === 'DELETE' ? 0 : (body.days as unknown[]).length, syncedAt: this.now().toISOString() } as T;
    }
    if (!resource && method === 'GET') return copy({ challenge: board.challenge, members: board.rows.map(row => ({ userId: row.userId, displayName: row.displayName })) }) as T;
    throw new Error('Ruta no disponible en esta demostración.');
  }
}
