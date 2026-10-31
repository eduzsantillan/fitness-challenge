import { describe, expect, it } from 'vitest';
import {
  COMPLETION_PHRASES, getCompletionPresentation,
  type CompletionInput, type CompletionResult, type CompletionRow,
} from '../src/completion-helpers';

const row = (userId: string, steps: number | null, displayName = userId): CompletionRow => ({ userId, steps, displayName });
const result: CompletionResult = {
  finalizedAt: '2026-11-01T05:00:00.000Z', outcome: 'winner', winnerUserIds: ['me'], hasMissingData: false,
  prizeRule: 'others', payerUserIds: ['friend'], receivedAt: null, receivedBy: null,
};
const base: CompletionInput = {
  challengeId: 'weekend-walk', userId: 'me', prize: 'un brunch',
  rows: [row('me', 20_000, 'María'), row('friend', 10_000, 'Alex')], result,
};
const present = (patch: Partial<CompletionInput> = {}) => getCompletionPresentation({ ...base, ...patch })!;

describe('frozen completed challenge storytelling', () => {
  it('does not invent a result from a board without a server-finalized result', () => {
    expect(getCompletionPresentation({ ...base, result: null })).toBeNull();
    expect(getCompletionPresentation({ ...base, result: undefined })).toBeNull();
  });
  it('contains six distinct plain-text phrases for every completion scenario', () => {
    expect(Object.keys(COMPLETION_PHRASES)).toHaveLength(6);
    for (const phrases of Object.values(COMPLETION_PHRASES)) {
      expect(phrases).toHaveLength(6);
      expect(new Set(phrases).size).toBe(6);
      expect(phrases.every(phrase => phrase.length > 30)).toBe(true);
    }
  });
  it('uses the authoritative winner and keeps a stable friendly story on revisits', () => {
    const completion = present();
    expect(completion.scenario).toBe('winner');
    expect(completion.title).toBe('Este reto es tuyo.');
    expect(completion.winners.map(winner => winner.userId)).toEqual(['me']);
    expect(completion.showCelebration).toBe(true);
    expect(present()).toEqual(completion);
    expect(present({ rows: [...base.rows].reverse() }).message).toBe(completion.message);
    const alternatives = Array.from({ length: 30 }, (_, i) => present({ challengeId: `reto-${i}` }).message);
    expect(new Set(alternatives).size).toBeGreaterThan(1);
  });
  it('never recomputes a different server outcome from the numerical ranking', () => {
    const completion = present({ result: { ...result, outcome: 'incomplete', winnerUserIds: [], hasMissingData: true } });
    expect(completion.scenario).toBe('incomplete');
    expect(completion.showCelebration).toBe(false);
    expect(completion.prize.state).toBe('unresolved');
    expect(completion.prize.canMarkReceived).toBe(false);
    expect(completion.resultNote).toContain('no equivalen a cero');
    expect(present({ result: { ...result, outcome: 'solo', winnerUserIds: [] } }).scenario).toBe('solo');
  });
  it('celebrates the whole group without shaming a non-winning participant', () => {
    const completion = present({ userId: 'friend' });
    expect(completion.scenario).toBe('participant');
    expect(completion.title).toContain('María');
    expect(completion.showCelebration).toBe(true);
    expect(completion.ownRank).toBe(2);
    expect(completion.ownSteps).toBe(10_000);
  });
  it('preserves null, measured zero, competition ranks and shared positions', () => {
    const completion = present({ rows: [row('d', null), row('c', 0), row('b', 100), row('me', 100)] });
    expect(completion.rankedRows.map(person => [person.userId, person.steps, person.rank])).toEqual([
      ['b', 100, 1], ['me', 100, 1], ['c', 0, 3], ['d', null, null],
    ]);
    expect(completion.groupSteps).toBe(200);
    expect(present({ rows: [row('me', null), row('friend', null)] }).groupSteps).toBeNull();
    expect(present({ rows: [row('me', 0), row('friend', 0)], result: { ...result, outcome: 'no_data', winnerUserIds: [] } }).groupSteps).toBe(0);
    expect(present({ userId: 'absent' }).ownSteps).toBeNull();
    expect(present({ userId: 'absent' }).ownRank).toBeNull();
  });
  it('does not add repeated snapshots or treat invalid counts as measured steps', () => {
    expect(present({ rows: [row('me', 100), row('me', 100), row('friend', 50)] }).groupSteps).toBe(150);
    for (const steps of [-1, NaN, Infinity, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
      const completion = present({ rows: [row('me', steps), row('friend', 50)] });
      expect(completion.ownSteps).toBeNull();
      expect(completion.ownRank).toBeNull();
      expect(completion.groupSteps).toBe(50);
    }
  });
  it('keeps a tie shared rather than electing a single winner or assigning the prize', () => {
    const completion = present({
      rows: [row('me', 100), row('friend', 100)],
      result: { ...result, outcome: 'tie', winnerUserIds: ['me', 'friend'], payerUserIds: [] },
    });
    expect(completion.scenario).toBe('tie');
    expect(completion.winners).toHaveLength(2);
    expect(completion.rankedRows.every(person => person.rank === 1 && person.isWinner)).toBe(true);
    expect(completion.prize.state).toBe('unresolved');
    expect(completion.prize.description).toContain('empate');
    expect(completion.prize.payerIds).toEqual([]);
    expect(completion.prize.canMarkReceived).toBe(false);
    expect(completion.showCelebration).toBe(true);
  });
  it('does not produce a podium or automatic obligation for no-data, incomplete, or solo outcomes', () => {
    for (const outcome of ['no_data', 'incomplete', 'solo'] as const) {
      const completion = present({ result: { ...result, outcome, winnerUserIds: [], payerUserIds: [] } });
      expect(completion.showCelebration).toBe(false);
      expect(completion.prize.state).toBe('unresolved');
      expect(completion.prize.canMarkReceived).toBe(false);
      expect(completion.winners).toEqual([]);
    }
  });
  it('keeps arbitrary name and prize text literal instead of interpolating replacement syntax', () => {
    const prize = '<b>un brunch</b> $& {winner}';
    const name = '<img src=x> $&';
    const completion = present({ userId: 'friend', prize, rows: [row('me', 100, name), row('friend', 50)] });
    expect(completion.title).toContain(name);
    expect(completion.prize.description).toContain(prize);
    const messages = Array.from({ length: 30 }, (_, i) => present({ prize, challengeId: `reto-${i}` }).message);
    expect(messages.some(message => message.includes(prize))).toBe(true);
  });
});

describe('the prize is a social hand-off, not an invented payment', () => {
  it('uses server-designated payers and only allows the surviving individual winner to confirm receipt', () => {
    const winner = present();
    expect(winner.prize.state).toBe('pending');
    expect(winner.prize.payerIds).toEqual(['friend']);
    expect(winner.prize.recipientIds).toEqual(['me']);
    expect(winner.prize.description).toContain('Alex');
    expect(winner.prize.canMarkReceived).toBe(true);
    const payer = present({ userId: 'friend' });
    expect(payer.prize.title).toBe('Te toca un bonito cierre');
    expect(payer.prize.description).toContain('Te toca entregar');
    expect(payer.prize.canMarkReceived).toBe(false);
    expect(present({ userId: 'outsider' }).prize.canMarkReceived).toBe(false);
  });
  it('supports several assigned participants without duplicating them or assigning the winner to themselves', () => {
    const completion = present({
      userId: 'friend', rows: [...base.rows, row('third', 5_000, 'Sam')],
      result: { ...result, payerUserIds: ['friend', 'third', 'third', 'me'] },
    });
    expect(completion.prize.payerIds).toEqual(['friend', 'third']);
    expect(completion.prize.description).toContain('coordinar con Sam');
    expect(completion.prize.description).not.toContain('coordinar con Alex');
  });
  it('does not infer a debt from a ranking when the agreed rule is coordinate', () => {
    const completion = present({ result: { ...result, prizeRule: 'coordinate', payerUserIds: [] } });
    expect(completion.prize.payerIds).toEqual([]);
    expect(completion.prize.description).toContain('No hay una persona asignada automáticamente');
    expect(completion.prize.canMarkReceived).toBe(true);
  });
  it('uses only an explicit creator payer rather than assuming the creator or last place owes', () => {
    const completion = present({
      rows: [...base.rows, row('organizer', 50, 'Dani')],
      result: { ...result, prizeRule: 'creator', payerUserIds: ['organizer'] },
    });
    expect(completion.prize.payerIds).toEqual(['organizer']);
    expect(completion.prize.description).toContain('Dani');
    expect(completion.prize.description).not.toContain('Alex');
  });
  it('turns confirmation into a quiet delivered state and removes the repeated action', () => {
    const completion = present({ result: { ...result, receivedAt: '2026-11-02T10:00:00Z', receivedBy: 'me' } });
    expect(completion.prize.state).toBe('delivered');
    expect(completion.prize.title).toBe('Premio recibido');
    expect(completion.prize.canMarkReceived).toBe(false);
  });
  it('does not offer prize actions if no prize was written', () => {
    for (const prize of ['', '  ', undefined]) {
      expect(present({ prize }).prize).toMatchObject({ state: 'none', canMarkReceived: false, payerIds: [], recipientIds: [] });
    }
  });
  it('does not reveal removed identities or fabricate a replacement winner after privacy redactions', () => {
    const completion = present({
      userId: 'friend', rows: [row('friend', 10_000, 'Alex')],
      result: { ...result, hasRedactions: true },
    });
    expect(completion.scenario).toBe('participant');
    expect(completion.winners).toEqual([]);
    expect(completion.showCelebration).toBe(false);
    expect(completion.prize.state).toBe('unresolved');
    expect(completion.prize.canMarkReceived).toBe(false);
    expect(completion.prize.recipientIds).toEqual([]);
    expect(completion.resultNote).toContain('dejaron de compartirse');
    expect(JSON.stringify(completion)).not.toContain('María');
    expect(completion.ownRank).toBeNull();
    expect(completion.rankedRows.every(person => person.rank === null)).toBe(true);
  });
  it('recognizes anonymized tombstones as redacted, not as a surviving winner', () => {
    const completion = present({
      userId: 'friend', rows: [row('friend', 10_000, 'Alex'), { ...row('removed-123', null, 'Participante que salió'), redacted: true }],
      result: { ...result, winnerUserIds: ['removed-123'], hasRedactions: true },
    });
    expect(completion.winners).toEqual([]);
    expect(completion.prize.state).toBe('unresolved');
    expect(completion.prize.canMarkReceived).toBe(false);
    expect(completion.showCelebration).toBe(false);
    expect(completion.rankedRows.find(person => person.redacted)?.isWinner).toBe(false);
    expect(completion.title).not.toContain('Participante que salió');
  });
  it('limits presentation to public row fields and always masks a redacted row', () => {
    const completion = present({
      userId: 'friend', rows: [row('friend', 10_000, 'Alex'), { ...row('removed-123', 20_000, 'Old private name'), redacted: true, privateField: 'not-for-presentation' } as CompletionRow],
      result: { ...result, winnerUserIds: ['removed-123'], hasRedactions: true },
    });
    expect(completion.groupSteps).toBe(10_000);
    expect(completion.rankedRows.find(person => person.redacted)?.steps).toBeNull();
    expect(JSON.stringify(completion)).not.toContain('Old private name');
    expect(JSON.stringify(completion)).not.toContain('not-for-presentation');
  });
  it('preserves a confirmed receipt as a historical event after the winner withdraws', () => {
    const completion = present({
      userId: 'friend', rows: [row('friend', 10_000, 'Alex'), { ...row('removed-123', null, 'Participante que salió'), redacted: true }],
      result: { ...result, winnerUserIds: ['removed-123'], hasRedactions: true, receivedAt: '2026-11-02T10:00:00Z', receivedBy: null },
    });
    expect(completion.prize.state).toBe('delivered');
    expect(completion.prize.canMarkReceived).toBe(false);
    expect(completion.prize.recipientIds).toEqual([]);
  });
  it('omits removed payers and falls back to coordination without exposing their IDs', () => {
    const completion = present({ result: { ...result, payerUserIds: ['removed-private-id'], hasRedactions: true } });
    expect(completion.prize.payerIds).toEqual([]);
    expect(completion.prize.description).toContain('No hay una persona asignada automáticamente');
    expect(JSON.stringify(completion)).not.toContain('removed-private-id');
  });
  it('retains a surviving winner and their receipt action without inventing revised numeric ranks', () => {
    const completion = present({
      rows: [row('me', 20_000, 'María'), { ...row('removed-123', null, 'Participante que salió'), redacted: true }],
      result: { ...result, payerUserIds: [], hasRedactions: true },
    });
    expect(completion.scenario).toBe('winner');
    expect(completion.winners.map(person => person.userId)).toEqual(['me']);
    expect(completion.prize.canMarkReceived).toBe(true);
    expect(completion.rankedRows.find(person => person.userId === 'me')?.isWinner).toBe(true);
    expect(completion.ownRank).toBeNull();
  });
});
