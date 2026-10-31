import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChallengeList, ChallengeDetail, CreateChallenge } from '../src/ChallengeViews';
import { COMPACT_MESSAGES } from '../src/compact-copy';
import { ProfileView } from '../src/ProfileView';
import type { Board, Profile } from '../src/types';
const noop = () => {};
const challenge = { id:'simple', title:'Mi reto', ownerId:'a', startDate:'2026-10-31', endDate:'2026-11-06', timeZone:'UTC', createdAt:'2026-10-31T10:00:00Z', prize:'Una cena' };
const board: Board = { challenge, rows:[{ userId:'a', displayName:'Ana', steps:9000, workoutSeconds:null, days:[] },{ userId:'b', displayName:'Alex', steps:null, workoutSeconds:null, days:[] }] };
describe('minimal operational UI', () => {
  it('keeps six brief, distinct messages per active scenario', () => {
    for (const messages of Object.values(COMPACT_MESSAGES)) { expect(messages).toHaveLength(6); expect(new Set(messages).size).toBe(6); expect(messages.every(message => message.length < 55)).toBe(true); }
  });
  it('has one create action and no marketing intro or duplicate create tile', () => {
    const html = renderToStaticMarkup(<ChallengeList challenges={[]} today="2026-10-31" displayName="Ana" onCreate={noop} onOpen={noop} onFilter={noop} />);
    expect(html).toContain('<h1>Mis retos</h1>'); expect(html.match(/Crear reto/g)).toHaveLength(1);
    expect(html).not.toContain('Caminar está bien'); expect(html).not.toContain('El próximo buen plan');
  });
  it('puts prize and readable step ranking first, keeps destructive action in closed details', () => {
    const html = renderToStaticMarkup(<ChallengeDetail board={board} userId="a" today="2026-10-31" busy={false} onBack={noop} onInvite={noop} onRefresh={noop} onLeave={noop} onReceive={noop} onRematch={noop} onCopy={noop} />);
    expect(html).toContain('Una cena'); expect(html).toContain('Clasificación'); expect(html).toContain('9000'); expect(html).toContain('sin datos');
    expect(html).toMatch(/<details class="simple-details"><summary>Detalles del reto/); expect(html).not.toContain('prize-art'); expect(html).not.toContain('motivation-signature');
  });
  it('defaults profile to daily steps and does not render private code into markup', () => {
    const profile: Profile = { userId:'a', displayName:'Ana', timeZone:'UTC', userCode:'PRIVATE-CODE-FOR-TEST-ONLY' };
    const html = renderToStaticMarkup(<ProfileView profile={profile} days={[{date:'2026-10-31',steps:9000}]} today="2026-10-31" demo={false} busy={false} endpoint="https://example.test/api/steps" onCopy={noop} onSaveName={noop} onRotate={noop} onLogout={noop} onPrivacy={noop} />);
    expect(html).toContain('class="selected" aria-pressed="true">Día'); expect(html).toContain('9000'); expect(html).not.toContain(profile.userCode);
    expect(html).toMatch(/<details class="simple-details settings-section"><summary>/); expect(html).toContain('Atajos y código'); expect(html).not.toContain('EL PUENTE CON TUS PASOS');
  });
  it('uses one duration input instead of preset/stepper controls while preserving all 1–31 day values', () => {
    const html = renderToStaticMarkup(<CreateChallenge today="2026-10-31" busy={false} onCreate={noop} />);
    expect(html).toContain('name="durationDays"'); expect(html).toContain('min="1" max="31"');
    expect(html).not.toContain('Un día más'); expect(html).not.toContain('duration-presets'); expect(html).toContain('compartes tus pasos');
  });
});
