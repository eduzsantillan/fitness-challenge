/** Presentation only: the server, never a browser clock, decides when a result is final. */
export type CompletionRow = { userId: string; displayName: string; steps: number | null; redacted?: boolean };
export type CompletionResult = {
  finalizedAt: string;
  outcome: 'winner' | 'tie' | 'no_data' | 'incomplete' | 'solo';
  winnerUserIds: readonly string[];
  hasMissingData: boolean;
  prizeRule: 'coordinate' | 'others' | 'creator';
  payerUserIds: readonly string[];
  receivedAt: string | null;
  receivedBy: string | null;
  hasRedactions?: boolean;
};
export type CompletionScenario = 'winner' | 'participant' | 'tie' | 'incomplete' | 'no-data' | 'solo';
export type CompletionRankedRow = CompletionRow & { rank: number | null; isWinner: boolean; isMe: boolean };
export type CompletionPrize = {
  state: 'none' | 'unresolved' | 'pending' | 'delivered';
  title: string; description: string;
  payerIds: string[]; recipientIds: string[]; canMarkReceived: boolean;
};
export type CompletionPresentation = {
  scenario: CompletionScenario; eyebrow: string; title: string; message: string; resultNote: string;
  groupSteps: number | null; ownSteps: number | null; ownRank: number | null;
  winners: CompletionRow[]; rankedRows: CompletionRankedRow[]; showCelebration: boolean;
  prize: CompletionPrize;
};
export type CompletionInput = {
  challengeId: string; userId: string; prize?: string;
  rows: readonly CompletionRow[]; result: CompletionResult | null | undefined;
};

/** Plain text only. Keep names and prize text in normal React children, never HTML. */
export const COMPLETION_PHRASES: Readonly<Record<CompletionScenario, readonly string[]>> = {
  winner: [
    'La meta llegó y tú pusiste el punto final más alto. «{prize}» entra en el próximo capítulo.',
    'Primer puesto en los pasos registrados. Tus zapatillas merecen unos créditos especiales.',
    'Este capítulo lleva tu nombre arriba. Ahora toca celebrar, sin necesidad de otro kilómetro.',
    'Marcador cerrado y una historia que contar. «{prize}» ya tiene protagonista.',
    'Llegaste a lo más alto de este reto. El sofá acaba de solicitar una foto contigo.',
    'Tus pasos registrados se llevaron el primer puesto. El discurso de las zapatillas puede ser breve.',
  ],
  participant: [
    'No hace falta quedar primero para ser parte de una buena historia. Gracias por caminarla con el grupo.',
    'El marcador ya cerró; las anécdotas siguen abiertas. El próximo capítulo puede empezar con una invitación.',
    'Hasta aquí el pique, no la compañía. «{prize}» es una buena excusa para volver a reunirse.',
    'Este reto se va al álbum. Tus zapatillas también salen en los créditos.',
    'Hubo pasos, hubo grupo y ahora hay una historia para recordar. Eso también se celebra.',
    'Meta cruzada. El sofá propone una ceremonia de clausura y el grupo pone las anécdotas.',
  ],
  tie: [
    'Mismo primer puesto, distintas zapatillas. La foto final necesita un poco más de espacio.',
    'El marcador no quiso elegir a una sola persona. «{prize}» necesita una decisión en equipo.',
    'Empate en cabeza: más protagonistas para el mismo final. El premio lo acuerda el grupo.',
    'Ni un paso registrado de diferencia arriba. Las zapatillas firman tablas y piden una foto.',
    'La meta se comparte esta vez. No hay desempate secreto: toca acordar cómo celebrar.',
    'Final compartido. «{prize}» acaba de descubrir las ventajas del trabajo en equipo.',
  ],
  incomplete: [
    'El plazo terminó, pero faltaron datos de participantes. Guardamos lo recibido, no inventamos un ganador.',
    'La historia cerró con algún espacio en blanco. El premio espera una decisión del grupo.',
    'Llegó la meta; no llegaron todos los datos. «{prize}» no se asigna automáticamente.',
    'Este final tiene un asterisco: faltan registros. Los pasos que sí llegaron quedan aquí.',
    'El marcador se guardó tal como llegó. Sin todos los datos, la corona sigue en su caja.',
    'Reto cerrado, resultado incompleto. Una conversación en grupo vale más que adivinar el final.',
  ],
  'no-data': [
    'No hubo pasos suficientes registrados para elegir un ganador. Un marcador no cuenta toda la historia.',
    'Este reto cerró sin un primer puesto. «{prize}» puede esperar a la próxima aventura.',
    'Sin un resultado para premiar esta vez. Las zapatillas no necesitan dar explicaciones.',
    'El marcador no eligió protagonista. Queda abierta la invitación a un nuevo capítulo.',
    'La historia termina sin ganador registrado. No sabemos cuánto caminaron fuera del marcador.',
    'No hay podio esta vez. Sí queda una buena excusa para volver a intentarlo en compañía.',
  ],
  solo: [
    'Un reto contigo y tus pasos. Sin rival no hay ganador de grupo, pero sí un capítulo para guardar.',
    'Esta aventura terminó en solitario. La próxima puede tener más personajes.',
    'Tu recorrido queda aquí. «{prize}» no se asigna por competir a solas.',
    'Un solo nombre en los créditos. Comparte la próxima invitación y armamos el reparto.',
    'Esta vez caminaste tu propia historia. El podio de grupo espera compañía.',
    'Reto cerrado con una sola persona. Tus pasos se guardan; la revancha puede ser en equipo.',
  ],
};

const EYEBROWS: Record<CompletionScenario, string> = {
  winner: 'Tu capítulo ganador', participant: 'Un final para compartir', tie: 'Una meta compartida',
  incomplete: 'Un final con un asterisco', 'no-data': 'Cada historia tiene su ritmo', solo: 'Tu propio recorrido',
};

function phraseIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return (hash >>> 0) % length;
}
function measuredSteps(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function unique(ids: readonly string[]): string[] { return [...new Set(ids)]; }
function personName(row: CompletionRow): string { return row.displayName.trim() || 'Un participante'; }
function names(rows: readonly CompletionRow[]): string {
  return new Intl.ListFormat('es', { style: 'long', type: 'conjunction' }).format(rows.map(personName));
}

function prizePresentation(
  input: CompletionInput, rows: readonly CompletionRow[], result: CompletionResult, winnerRows: CompletionRow[],
): CompletionPrize {
  const prize = input.prize?.trim() ?? '';
  const base = { payerIds: [] as string[], recipientIds: [] as string[], canMarkReceived: false };
  if (!prize) return { ...base, state: 'none', title: 'Un reto para recordar', description: 'Este reto no tiene un premio escrito.' };
  const winnerIds = unique(result.winnerUserIds);
  const availableIds = new Set(rows.filter(row => !row.redacted).map(row => row.userId));
  const payerIds = unique(result.payerUserIds).filter(id => availableIds.has(id) && !winnerIds.includes(id));
  const recipientIds = winnerRows.map(row => row.userId);
  // Receipt is a historical event even if the winner later withdraws their shared data.
  if (result.outcome === 'winner' && result.receivedAt) return {
    ...base, payerIds, recipientIds, state: 'delivered', title: 'Premio recibido',
    description: 'La persona ganadora confirmó que recibió el premio. Un bonito cierre para esta historia.',
  };
  // Never reconstruct a deleted person's identity or infer an obligation from the ranking.
  const validWinner = result.outcome === 'winner' && winnerIds.length === 1 && winnerRows.length === 1 && winnerRows[0]!.steps !== null;
  if (!validWinner) {
    const description = result.outcome === 'tie'
      ? 'El empate no asigna el premio automáticamente. Acuerden juntos cómo celebrarlo.'
      : result.outcome === 'winner'
        ? 'El resultado se conserva, pero ya no se muestran todos los participantes. La entrega se coordina fuera de la app.'
        : 'No hay una entrega automática sin un ganador individual. El grupo decide qué hacer con el premio.';
    return { ...base, state: 'unresolved', title: 'El premio, en conversación', description };
  }
  const winner = winnerRows[0]!;
  const winnerRecipient = winner.userId === input.userId ? 'ti' : personName(winner);
  const payerRows = payerIds.flatMap(id => { const row = rows.find(candidate => candidate.userId === id); return row ? [row] : []; });
  let title: string; let description: string;
  if (result.prizeRule === 'creator' && !payerRows.length && !result.hasRedactions) {
    title = 'El premio se queda en casa';
    description = 'Quien creó el reto también lo ganó. No asignamos la entrega a otra persona del grupo.';
  } else if (result.prizeRule === 'coordinate' || !payerRows.length) {
    title = winner.userId === input.userId ? 'Tu premio, próximo capítulo' : 'Pónganle fecha al premio';
    description = `El grupo acuerda cómo y cuándo entregar «${prize}» a ${winnerRecipient}. No hay una persona asignada automáticamente.`;
  } else if (payerIds.includes(input.userId)) {
    title = 'Te toca un bonito cierre';
    description = payerRows.length === 1
      ? `Te toca entregar «${prize}» a ${winnerRecipient}, según la regla elegida para este reto.`
      : `Te toca coordinar con ${names(payerRows.filter(row => row.userId !== input.userId))} la entrega de «${prize}» a ${winnerRecipient}.`;
  } else {
    title = winner.userId === input.userId ? 'Un premio te espera' : 'El próximo capítulo: el premio';
    description = `${names(payerRows)} ${payerRows.length === 1 ? 'se encarga' : 'se encargan'} de entregar «${prize}» a ${winnerRecipient}.`;
  }
  return {
    state: 'pending', title, description, payerIds, recipientIds,
    canMarkReceived: winner.userId === input.userId,
  };
}

/** Uses a frozen result as the source of truth; null means the challenge has not been finalized. */
export function getCompletionPresentation(input: CompletionInput): CompletionPresentation | null {
  const result = input.result;
  if (!result) return null;
  // Membership IDs are unique on the server. Defensive de-duplication never adds duplicate snapshots.
  const seen = new Set<string>();
  const rows = input.rows.filter(row => {
    if (seen.has(row.userId)) return false;
    seen.add(row.userId); return true;
  }).map((row): CompletionRow => ({
    userId: row.userId,
    displayName: row.redacted ? 'Participante que salió' : row.displayName,
    steps: row.redacted ? null : measuredSteps(row.steps),
    ...(row.redacted ? { redacted: true } : {}),
  }));
  const winnerIds = unique(result.winnerUserIds);
  const winners = rows.filter(row => !row.redacted && winnerIds.includes(row.userId));
  const scenario: CompletionScenario = result.outcome === 'winner'
    ? winnerIds.includes(input.userId) && winners.some(row => row.userId === input.userId) ? 'winner' : 'participant'
    : result.outcome === 'no_data' ? 'no-data' : result.outcome;
  const sortedRows = [...rows].sort((a, b) => {
    if (a.steps === null) return b.steps === null ? a.userId.localeCompare(b.userId) : 1;
    if (b.steps === null) return -1;
    return b.steps - a.steps || a.userId.localeCompare(b.userId);
  });
  const rankedRows = sortedRows.map((row): CompletionRankedRow => ({
    // A withdrawn row may have been ahead: do not silently promote anyone after privacy removal.
    ...row, rank: row.steps === null || result.hasRedactions ? null : rows.filter(other => other.steps !== null && other.steps > row.steps!).length + 1,
    isWinner: !row.redacted && winnerIds.includes(row.userId) && (result.outcome === 'winner' || result.outcome === 'tie'),
    isMe: !row.redacted && row.userId === input.userId,
  }));
  const me = rankedRows.find(row => row.isMe);
  const known = rows.filter(row => row.steps !== null);
  const total = known.reduce((sum, row) => sum + row.steps!, 0);
  const groupSteps = known.length && Number.isSafeInteger(total) ? total : null;
  let title: string;
  if (scenario === 'winner') title = 'Este reto es tuyo.';
  else if (scenario === 'participant') title = winners.length === 1 ? `${personName(winners[0]!)} se lleva el primer puesto.` : 'Un reto para recordar.';
  else if (scenario === 'tie') title = 'La meta se comparte.';
  else if (scenario === 'incomplete') title = 'Cerramos sin adivinar.';
  else if (scenario === 'solo') title = 'Tu camino también cuenta.';
  else title = 'Esta vez, sin podio.';
  const phrases = COMPLETION_PHRASES[scenario];
  const phrase = phrases[phraseIndex(`${input.challengeId}|${scenario}`, phrases.length)]!;
  const prizeText = input.prize?.trim() || 'el premio';
  const message = phrase.replace(/\{prize\}/g, () => prizeText);
  const resultNote = 'Resultado guardado con los pasos recibidos durante el reto.'
    + (result.hasMissingData ? ' Faltaron registros de participantes; no equivalen a cero pasos.' : '')
    + (result.hasRedactions ? ' Algunos datos dejaron de compartirse y ya no se muestran.' : '');
  return {
    scenario, eyebrow: EYEBROWS[scenario], title, message, resultNote,
    groupSteps, ownSteps: me?.steps ?? null, ownRank: me?.rank ?? null,
    winners, rankedRows,
    showCelebration: (result.outcome === 'winner' && winnerIds.length === 1 && winners.length === 1) || (result.outcome === 'tie' && winners.length > 1),
    prize: prizePresentation(input, rows, result, winners),
  };
}
