vi.mock('../src/auth', () => ({ login: vi.fn() }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { setLanguage, t, locale, errorText, LanguagePicker } from '../src/i18n';
import { returnChallenge } from '../src/navigation';
import { ChallengeList, CreateChallenge, JoinChallenge, ChallengeDetail } from '../src/ChallengeViews';
import { AuthForm } from '../src/AuthForm';
import { ProfileView } from '../src/ProfileView';
import { ModalFrame } from '../src/components';
import { getCompletionPresentation } from '../src/completion-helpers';
import { compactMotivation } from '../src/compact-copy';
import { getMotivation } from '../src/challenge-helpers';
import { readFileSync } from 'node:fs';
const noop=()=>{};
const challenge={id:'a',title:'Caminar con Alex',prize:'Café para Ana',ownerId:'a',startDate:'2099-01-01',endDate:'2099-01-07',timeZone:'UTC',createdAt:'2099-01-01T00:00:00Z',participants:[{displayName:'Ana'},{displayName:'Alex'}]};
afterEach(()=>setLanguage('es'));
describe('language and navigation',()=>{
 it('restores only an authorized challenge and gives a single challenge direct access',()=>{
  expect(returnChallenge('b',[{id:'a'},{id:'b'}])).toBe('b');
  expect(returnChallenge('private-other-account',[{id:'a'},{id:'b'}])).toBeUndefined();
  expect(returnChallenge(undefined,[{id:'a'}])).toBe('a');
  expect(returnChallenge('deleted',[])).toBeUndefined();
 });
 it('keeps Spanish as the default and formats English without translating user content',()=>{
  expect(t('Mi perfil')).toBe('Mi perfil');setLanguage('en');
  expect(locale()).toBe('en-CA');expect(t('Día {0} de {1}',[3,7])).toBe('Day 3 of 7');
  const html=render(<ChallengeList challenges={[challenge]} today="2099-01-01" displayName="Ana" onCreate={noop} onOpen={noop} onFilter={noop}/>);
  for(const text of ['My challenges','Create challenge','Ana · Alex','Caminar con Alex','Café para Ana'])expect(html).toContain(text);
 });
 it('translates forms, consent, profile settings, modal close and unknown server errors',()=>{
  setLanguage('en');
  const create=render(<CreateChallenge today="2099-01-01" busy={false} onCreate={noop}/>);
  expect(create).toContain('Challenge name');expect(create).toContain('Creating shares your challenge steps');
  const join=render(<JoinChallenge preview={{challenge,creator:{displayName:'Ana'},members:[{displayName:'Ana'}]}} busy={false} onJoin={noop}/>);
  expect(join).toContain('Join challenge');expect(join).toContain('accepting the prize rule');
  expect(render(<AuthForm initialRegister onSuccess={noop}/>)).toContain('Password');
  expect(render(<ModalFrame title="Invite friends" onClose={noop}>Test</ModalFrame>)).toContain('Close dialog');
  const profile=render(<ProfileView profile={{userId:'a',displayName:'Ana',timeZone:'UTC',userCode:'PRIVATE'}} days={[]} today="2099-01-01" demo={false} busy={false} endpoint="https://example.test/api/steps" onCopy={noop} onSaveName={noop} onRotate={noop} onLogout={noop} onPrivacy={noop}/>);
  expect(profile).toContain('Language');expect(profile).toContain('shortcuts-guide.md');expect(profile).not.toContain('PRIVATE');
  expect(render(<LanguagePicker/>)).toContain('value="en" selected');
  expect(errorText('Inicia sesión.')).toBe('Please log in.');expect(errorText('El servidor falló.')).not.toContain('servidor');
 });
 it('keeps English completion copy and ranking conservative',()=>{
  setLanguage('en');
  const rows=[{userId:'a',displayName:'Ana',steps:10},{userId:'b',displayName:'Alex',steps:5}];
  const story=getCompletionPresentation({challengeId:'a',userId:'b',prize:'Un café',rows,result:{closedAt:'2099-01-08T00:00:00Z',finalizedAt:'2099-01-08T00:00:00Z',outcome:'winner',winnerUserIds:['a'],payerUserIds:['b'],prizeRule:'others',hasMissingData:false,hasRedactions:false,receivedAt:null,receivedBy:null}})!;
  expect(story.title).toBe('Ana takes first place.');expect(story.prize.description).toContain('Un café');expect(story.prize.description).toContain("You're providing");expect(story.prize.canMarkReceived).toBe(false);
  expect(compactMotivation(getMotivation({challengeId:'a',userId:'a',rows,today:'2099-01-01',startDate:'2099-01-01',endDate:'2099-01-07',prize:'Un café'}))).not.toMatch(/á|é|paso|sofá/);
 });
 it('sets dialog size limits and symmetric gutters in the shared component CSS',()=>{
  const css=readFileSync('web/src/styles.css','utf8');expect(css).toContain('width:calc(100% - 20px); max-width:520px; margin:auto auto 10px');expect(css).toContain('overflow-wrap:anywhere');
 });
});
