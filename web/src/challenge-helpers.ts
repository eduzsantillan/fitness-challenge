/** Pure calendar helpers: `today` must already be a date in the challenge/profile zone. */
export type ChallengeStatus = 'upcoming' | 'active' | 'finished';
export type MotivationScenario = 'upcoming' | 'no-data' | 'starting' | 'solo' | 'behind' | 'leading' | 'tied' | 'finishing' | 'winner' | 'tied-finish' | 'finished' | 'incomplete';
export type MotivationRow = { userId: string; displayName: string; steps: number | null };
export type MotivationInput = {
  challengeId: string; prize: string; rows: readonly MotivationRow[]; userId: string;
  today: string; startDate: string; endDate: string;
};
export type Motivation = { scenario: MotivationScenario; eyebrow: string; message: string };
export type PersonalPeriod = 'day' | 'week' | 'month';
export type PersonalStepDay = { date: string; steps: number | null; updatedAt?: string; syncedAt?: string };
export type PersonalStepBucket = {
  key: string; label: string; startDate: string; endDate: string;
  steps: number | null; recordedDays: number; isFuture: boolean;
};
export type PersonalHistory = {
  period: PersonalPeriod; startDate: string; endDate: string; label: string;
  total: number | null; recordedDays: number; elapsedDays: number; buckets: PersonalStepBucket[];
};

const DAY_MS = 86_400_000;
function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function assertDate(value: string): void {
  if (!isDateKey(value)) throw new RangeError('Expected a valid YYYY-MM-DD date.');
}
function shiftDay(value: string, offset: number): string {
  return new Date(Date.parse(`${value}T12:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}
function dayDistance(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY_MS);
}
function firstMonday(value: string): string {
  return shiftDay(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7));
}
function monthStart(value: string, offset = 0): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const result = date.toISOString().slice(0, 10);
  assertDate(result);
  return result;
}
function monthEnd(value: string): string { return shiftDay(monthStart(value, 1), -1); }
function validSteps(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
const formatDate = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('es-ES', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`));

export function getChallengeStatus(startDate: string, endDate: string, today: string): ChallengeStatus {
  [startDate, endDate, today].forEach(assertDate);
  if (endDate < startDate) throw new RangeError('Challenge end date cannot precede its start.');
  return today < startDate ? 'upcoming' : today > endDate ? 'finished' : 'active';
}

/** Text only. Render with normal React children; never use dangerouslySetInnerHTML. */
export const MOTIVATION_PHRASES: Readonly<Record<MotivationScenario, readonly string[]>> = {
  upcoming: [
    '«{prize}» ya está en el radar. El reto empieza pronto.',
    'La línea de salida está lista. Tus zapatillas tienen una cita.',
    'Todavía no cuenta la salida, pero sí las ganas. ¡Pronto arrancamos!',
    'El grupo calienta motores. La aventura empieza en la fecha del reto.',
    '«{prize}» espera entre bastidores. Aún no empieza la función.',
    'Próxima parada: un reto con los tuyos. Por ahora, prepara tu mejor playlist.',
  ],
  'no-data': [
    'Todavía no recibimos tus pasos. Sincroniza cuando quieras y empieza la historia.',
    'Tu marcador está en blanco, no en cero. Falta recibir tus primeros pasos.',
    'Aquí hay sitio para tus pasos. Cuando los compartas, les ponemos número.',
    'Las zapatillas pueden estar trabajando; tu atajo todavía no nos lo ha contado.',
    '«{prize}» está en juego. Primero, hagamos que lleguen tus pasos.',
    'El marcador espera noticias tuyas. Una sincronización y nos ponemos al día.',
  ],
  starting: [
    'Cero pasos registrados por ahora. Cada paseo puede abrir el marcador.',
    'Marcador en cero, historia por escribir. «{prize}» ya tiene banda sonora.',
    'Todo empieza por un paso. El marcador no tiene ninguna prisa.',
    'Un cero también es un dato. Aquí estaremos cuando llegue el próximo paseo.',
    'Tus pasos recibidos empiezan en cero. La aventura sigue abierta.',
    'La casilla de salida tiene buenas vistas. El próximo capítulo lo escribes tú.',
  ],
  solo: [
    'Ya estás dentro. Invita a alguien: los piques amistosos saben mejor en compañía.',
    'Tienes el escenario para ti. Falta tu compañero de aventuras.',
    '«{prize}» pide un poco de emoción. Comparte el enlace e invita a tu rival favorito.',
    'Un reto, tus pasos y una plaza esperando compañía. ¿A quién llamamos?',
    'De momento caminas en solitario. El enlace de invitación pone el resto.',
    'La clasificación tiene una estrella: tú. Invita a alguien y montamos el dúo.',
  ],
  behind: [
    'Vas por detrás en los pasos registrados, pero la historia sigue abierta. A tu ritmo.',
    'Tu rival lleva ventaja. Un paseo puede darle un giro al guion, sin prisas.',
    '«{prize}» aún está en juego. Que no te distraiga demasiado el sofá.',
    'Hay ventaja al otro lado del marcador. Las remontadas también empiezan con un paso.',
    'La persecución más amable del mundo: tus zapatillas contra ese numerito.',
    'Hoy toca papel de perseguidor. Un capítulo emocionante, no un examen.',
  ],
  leading: [
    'Vas por delante en los pasos registrados. Mantén tu ritmo, que esto sigue.',
    'Lideras el marcador. «{prize}» te guiña un ojo, pero aún no está decidido.',
    'Tus zapatillas llevan la delantera. La corona todavía es de papel.',
    'Buen ritmo: estás arriba. Disfruta el paseo, no hace falta correr por el marcador.',
    'El primer puesto te queda bien. Por ahora, «{prize}» sigue en juego.',
    'Vas marcando el camino. Que tu playlist no se crea toda la responsable.',
  ],
  tied: [
    'Empate en los pasos registrados. Esto está más igualado que elegir dónde cenar.',
    'Mismo marcador, distintas zapatillas. «{prize}» no sabe a quién mirar.',
    'Vais a la par. El próximo paseo puede escribir otro capítulo.',
    'Empate arriba: hay sitio para dos en esta foto provisional.',
    'Ni un paso de diferencia en el marcador. El guion se está poniendo bueno.',
    'Tablas por ahora. El sofá acaba de pedir una revisión de la jugada.',
  ],
  finishing: [
    'Último tramo y vas por delante. «{prize}» está cerca, pero el reto sigue abierto.',
    'La recta final tiene emoción: lideras los pasos registrados, no hay ganador todavía.',
    'Queda poco y llevas ventaja. Mantén tu ritmo; las zapatillas aún no dan discursos.',
    '«{prize}» está en el horizonte. Vas primero, pero todavía no se cierra el marcador.',
    'Últimos días, buen ritmo y una ventaja provisional. Sigue disfrutando del camino.',
    'La meta se acerca y tú vas delante. El confeti todavía espera en su caja.',
  ],
  winner: [
    'Reto terminado: tienes más pasos registrados. «{prize}» ya puede salir a escena.',
    'Primer puesto al cierre. Tus zapatillas se han ganado una pequeña ovación.',
    'Con los datos recibidos, el reto es tuyo. ¡A celebrar «{prize}» con los tuyos!',
    'Marcador cerrado y tú arriba. El discurso de tus zapatillas puede ser breve.',
    'Ganaste este reto por pasos registrados. «{prize}» tiene nuevo protagonista.',
    'La meta ya está atrás: acabaste primero. Ahora sí, que aparezca ese confeti.',
  ],
  'tied-finish': [
    'Reto cerrado con empate en cabeza. «{prize}» necesita una decisión en equipo.',
    'Foto finish compartida. Terminasteis con los mismos pasos registrados.',
    'Empate final: dos protagonistas y un solo marcador. El premio lo acordáis vosotros.',
    'El marcador se cerró sin separar a quienes lideran. Las zapatillas firman tablas.',
    'Ni el último paso rompió el empate registrado. Toca brindar por el grupo.',
    'Final compartida. «{prize}» acaba de descubrir el trabajo en equipo.',
  ],
  finished: [
    'Reto terminado. Gracias por poner tus pasos en esta historia compartida.',
    'Marcador cerrado, anécdotas abiertas. El próximo pique ya encontrará su momento.',
    'La meta está cruzada. El premio es una excusa estupenda para reunir al grupo.',
    'Hasta aquí este reto. Tus zapatillas pueden salir en los créditos.',
    'Se acabó la cuenta, no las ganas de compartir camino. ¡Bien por estar aquí!',
    'Reto al álbum de recuerdos. El sofá propone una ceremonia de clausura.',
  ],
  incomplete: [
    'Terminó el plazo, pero faltan pasos por recibir. El resultado es provisional.',
    'La meta ya pasó; aún faltan datos del grupo. No declaramos ganador todavía.',
    '«{prize}» espera un momento: faltan datos y el marcador final es provisional.',
    'Reto cerrado, datos incompletos. El confeti espera a que se aclare el marcador.',
    'Quedan pasos sin confirmar. Mostramos lo recibido, no un ganador definitivo.',
    'Fin del reto, con un asterisco: faltan datos. El grupo decide cuándo cerrar el resultado.',
  ],
};

const EYEBROWS: Record<MotivationScenario, string> = {
  upcoming: 'En la línea de salida', 'no-data': 'Esperando tus pasos', starting: 'Tu primer capítulo',
  solo: 'Mejor en compañía', behind: 'Todavía hay historia', leading: 'Vas por delante',
  tied: 'Un empate con emoción', finishing: 'En la recta final', winner: '¡Reto conseguido!',
  'tied-finish': 'Final compartida', finished: 'Un reto para recordar', incomplete: 'Resultado provisional',
};

function phraseIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return (hash >>> 0) % length;
}

export function getMotivation(input: MotivationInput): Motivation {
  const status = getChallengeStatus(input.startDate, input.endDate, input.today);
  const rows = input.rows.map(row => ({ ...row, steps: validSteps(row.steps) }));
  const me = rows.find(row => row.userId === input.userId);
  const known = rows.flatMap(row => row.steps === null ? [] : [row.steps]);
  const maximum = known.length ? Math.max(...known) : null;
  const missing = rows.some(row => row.steps === null) || !me;
  const leaderCount = maximum === null ? 0 : rows.filter(row => row.steps === maximum).length;
  let scenario: MotivationScenario;
  if (status === 'upcoming') scenario = 'upcoming';
  else if (status === 'finished') {
    if (missing || !known.length) scenario = 'incomplete';
    else if (maximum === 0 || rows.length < 2) scenario = 'finished';
    else if (me?.steps === maximum) scenario = leaderCount > 1 ? 'tied-finish' : 'winner';
    else scenario = 'finished';
  } else if (!me || me.steps === null) scenario = 'no-data';
  else if (rows.length === 1) scenario = 'solo';
  else if (maximum === 0) scenario = 'starting';
  else if (me.steps === maximum && leaderCount > 1) scenario = 'tied';
  else if (me.steps === maximum) scenario = dayDistance(input.today, input.endDate) <= 1 ? 'finishing' : 'leading';
  else scenario = 'behind';
  const choices = MOTIVATION_PHRASES[scenario];
  const template = choices[phraseIndex(`${input.challengeId}|${input.today}|${scenario}`, choices.length)]!;
  const prize = input.prize.trim() || 'el premio';
  let message = template.replace(/\{prize\}/g, () => prize);
  if (status === 'active' && missing && ['leading', 'finishing', 'behind', 'tied'].includes(scenario)) {
    message += ' Clasificación provisional: aún faltan datos de participantes.';
  }
  return { scenario, eyebrow: EYEBROWS[scenario], message };
}

/** One date is one snapshot, never additive. Latest timestamp wins; otherwise last input wins. */
function dailySnapshots(days: readonly PersonalStepDay[]): Map<string, PersonalStepDay> {
  const dates = new Map<string, PersonalStepDay>();
  for (const day of days) {
    if (!isDateKey(day.date)) continue;
    const previous = dates.get(day.date);
    const time = Date.parse(day.updatedAt ?? day.syncedAt ?? '');
    const oldTime = previous ? Date.parse(previous.updatedAt ?? previous.syncedAt ?? '') : NaN;
    if (Number.isFinite(time) && Number.isFinite(oldTime) && time < oldTime) continue;
    dates.set(day.date, { ...day, steps: validSteps(day.steps) });
  }
  return dates;
}
function calendarLabel(period: PersonalPeriod, startDate: string, endDate: string): string {
  if (period === 'month') return formatDate(startDate, { month: 'long', year: 'numeric' });
  if (period === 'day') return formatDate(startDate, { day: 'numeric', month: 'long', year: 'numeric' });
  return `${formatDate(startDate, { day: 'numeric', month: 'short', year: 'numeric' })} – ${formatDate(endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** At most 31 buckets. Missing/future days stay null; a measured zero stays zero. */
export function groupPersonalSteps(
  days: readonly PersonalStepDay[], period: PersonalPeriod, options: { today: string; offset?: number },
): PersonalHistory {
  assertDate(options.today);
  const offset = options.offset ?? 0;
  if (!Number.isInteger(offset) || Math.abs(offset) > 1200) throw new RangeError('Invalid calendar offset.');
  let startDate: string; let endDate: string;
  if (period === 'month') { startDate = monthStart(options.today, offset); endDate = monthEnd(startDate); }
  else if (period === 'week') { startDate = shiftDay(firstMonday(options.today), offset * 7); endDate = shiftDay(startDate, 6); }
  else { startDate = shiftDay(options.today, offset); endDate = startDate; }
  assertDate(startDate); assertDate(endDate);
  const snapshots = dailySnapshots(days);
  const buckets = Array.from({ length: dayDistance(startDate, endDate) + 1 }, (_, index): PersonalStepBucket => {
    const date = shiftDay(startDate, index);
    const isFuture = date > options.today;
    const steps = isFuture ? null : snapshots.get(date)?.steps ?? null;
    return {
      key: date, label: period === 'month' ? String(index + 1) : formatDate(date, { weekday: 'short', day: 'numeric' }),
      startDate: date, endDate: date, steps, recordedDays: steps === null ? 0 : 1, isFuture,
    };
  });
  const recorded = buckets.filter(bucket => bucket.steps !== null);
  return {
    period, startDate, endDate, label: calendarLabel(period, startDate, endDate),
    total: recorded.length ? recorded.reduce((sum, bucket) => sum + bucket.steps!, 0) : null,
    recordedDays: recorded.length, elapsedDays: Math.max(0, Math.min(buckets.length, dayDistance(startDate, options.today) + 1)), buckets,
  };
}

/** Existing calendar periods, newest first; optional bounded result count for a history list. */
export function summarizePersonalSteps(days: readonly PersonalStepDay[], period: PersonalPeriod, limit = 120): PersonalStepBucket[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1200) throw new RangeError('Invalid history limit.');
  const groups = new Map<string, PersonalStepBucket>();
  for (const day of dailySnapshots(days).values()) {
    const start = period === 'day' ? day.date : period === 'week' ? firstMonday(day.date) : monthStart(day.date);
    const end = period === 'day' ? start : period === 'week' ? shiftDay(start, 6) : monthEnd(start);
    const bucket = groups.get(start) ?? { key: start, label: calendarLabel(period, start, end), startDate: start, endDate: end, steps: null, recordedDays: 0, isFuture: false };
    if (day.steps !== null) { bucket.steps = (bucket.steps ?? 0) + day.steps; bucket.recordedDays++; }
    groups.set(start, bucket);
  }
  return [...groups.values()].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, limit);
}
