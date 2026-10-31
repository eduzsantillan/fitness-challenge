import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompletedChallenge } from '../src/CompletedChallenge';
import { CreateChallenge, JoinChallenge } from '../src/ChallengeViews';
import type { Board, InvitePreview } from '../src/types';
const noop = () => {};
const make = (): Board => ({
  challenge: { id: 'final', ownerId: 'alice', title: 'El brunch', startDate: '2026-10-24', endDate: '2026-10-30', timeZone: 'America/Toronto', createdAt: '2026-10-24T12:00:00Z', prize: 'Un brunch', prizeRule: 'others' },
  rows: [{ userId: 'alice', displayName: 'Alice', steps: 200, workoutSeconds: null, days: [] }, { userId: 'bob', displayName: 'Bob', steps: 100, workoutSeconds: null, days: [] }],
  result: { finalizedAt: '2026-10-31T04:00:00Z', outcome: 'winner', winnerUserIds: ['alice'], hasMissingData: false, prizeRule: 'others', payerUserIds: ['bob'], receivedAt: null, receivedBy: null },
});
const view = (board: Board, userId = 'alice') => renderToStaticMarkup(<CompletedChallenge board={board} userId={userId} busy={false} onBack={noop} onReceive={noop} onRematch={noop} onCopy={noop} onLeave={noop} />);
describe('completed challenge interaction surfaces', () => {
  it('shows a permanent result, named prize handoff, receipt action and opt-in rematch', () => {
    const html = view(make());
    for (const label of ['Este reto es tuyo.', 'Así quedó la historia.', 'LO PREPARA', 'LO DISFRUTA', 'Ya recibí mi premio', 'Preparar la revancha', 'Retos terminados']) expect(html).toContain(label);
    expect(html).not.toContain('<dialog'); expect(html).not.toContain('autoplay');
  });
  it('does not offer the receipt button to the payer and shows who receives instead', () => {
    const html = view(make(), 'bob');
    expect(html).not.toContain('Ya recibí mi premio');
    expect(html).toContain('Te toca un bonito cierre'); expect(html).toContain('Alice se lleva el primer puesto.');
  });
  it('shows received status without any further claim action', () => {
    const board = make(); board.result = { ...board.result!, receivedAt: '2026-10-31T14:00:00Z', receivedBy: 'alice' };
    const html = view(board);
    expect(html).toContain('Buen plan, cumplido.'); expect(html).toContain('Confirmaste la recepción'); expect(html).not.toContain('Ya recibí mi premio');
  });
  it('escapes prize and names rather than rendering executable content', () => {
    const board = make(); board.challenge.prize = '<script>alert(1)</script>'; board.rows[0]!.displayName = '<img src=x onerror=alert(1)>';
    const html = view(board); expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;');
  });
  it('does not crown the remaining participant after a privacy withdrawal', () => {
    const board = make(); board.result = { ...board.result!, winnerUserIds: ['removed-test'], hasRedactions: true };
    board.rows[0] = { userId: 'removed-test', displayName: 'Participante que salió', steps: null, workoutSeconds: null, days: [], redacted: true };
    const html = view(board, 'bob'); expect(html).not.toContain('Bob se lleva el primer puesto'); expect(html).not.toContain('Ya recibí mi premio'); expect(html).toContain('sin volver a decidir quién ganó');
  });
  it('offers explicit prize rules at creation and repeats them before joining', () => {
    const form = renderToStaticMarkup(<CreateChallenge today="2026-10-31" busy={false} onCreate={noop} />);
    expect(form).toContain('El premio lo pone'); expect(form).toContain('value="coordinate" selected');
    const board = make(), preview: InvitePreview = { challenge: board.challenge, creator: { displayName: 'Alice' }, members: [{ displayName: 'Alice' }] };
    const invite = renderToStaticMarkup(<JoinChallenge preview={preview} busy={false} onJoin={noop} />);
    expect(invite).toContain('Quienes no ganan se organizan para entregar un solo premio'); expect(invite).toContain('aceptas la regla del premio');
  });
  it('limits celebration to transforms/opacity with reduced-motion equivalent and no loops', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(css).toContain('@media(prefers-reduced-motion:reduce){.celebrate');
    expect(css).not.toMatch(/\.celebrate[^}]*infinite/);
    expect(css).toContain('medal-arrive 260ms var(--ease)');
  });
});
