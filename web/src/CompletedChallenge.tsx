import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Copy, HeartHandshake, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { getCompletionPresentation } from './completion-helpers';
import { number, shortDate } from './dates';
import { RankingList } from './ui';
import type { Board } from './types';

// Celebration is a rare acknowledgement, not a reward animation on every poll or navigation.
const seen = new Set<string>();
function FinishArt({ animate, replay, shared }: { animate: boolean; replay: number; shared: boolean }) {
  return <div key={replay} className={`finish-art${animate ? ' celebrate' : ''}`} aria-hidden="true">
    <span className="finish-orbit" /><span className="finish-orbit orbit-two" />
    <div className="finish-medal"><span className="medal-kicker">RITMO CLUB</span>{shared ? <HeartHandshake size={66} strokeWidth={1.1} /> : <Trophy size={66} strokeWidth={1.1} />}<span className="medal-caption">PASO A PASO</span></div>
    <span className="finish-stamp"><Check size={19} /></span>
    {[0, 1, 2, 3, 4, 5].map(i => <span className={`finish-spark spark-${i}`} key={i}>{i % 2 ? '✳' : '✦'}</span>)}
  </div>;
}
export function CompletedChallenge({ board, userId, busy, onBack, onReceive, onRematch, onCopy, onLeave }: {
  board: Board; userId: string; busy: boolean; onBack: () => void; onReceive: () => void;
  onRematch: () => void; onCopy: (text: string) => void; onLeave: () => void;
}) {
  const c = board.challenge, result = board.result;
  const story = getCompletionPresentation({ challengeId: c.id, userId, prize: c.prize || '', rows: board.rows, result });
  const [confirmReceipt, setConfirmReceipt] = useState(false), [replay, setReplay] = useState(0);
  const [firstVisit] = useState(() => { const key = `${userId}:${c.id}:${result?.finalizedAt}`; if (seen.has(key)) return false; seen.add(key); return true; });
  if (!story || !result) return null;
  const people = (ids: readonly string[]) => ids.map(id => board.rows.find(row => row.userId === id)?.displayName).filter((name): name is string => Boolean(name));
  const payers = people(story.prize.payerIds), recipients = people(story.prize.recipientIds);
  const receivedDate = result.receivedAt ? new Intl.DateTimeFormat('es', { day:'numeric', month:'short', timeZone:c.timeZone }).format(new Date(result.receivedAt)) : '';
  const shareText = `${c.title} · ${shortDate(c.startDate)} — ${shortDate(c.endDate)}\n${story.title}\n${story.rankedRows.filter(r => r.steps !== null).map(r => `${r.displayName}: ${number(r.steps)} pasos`).join('\n')}${c.prize ? `\nPremio: ${c.prize}` : ''}`;
  return <>
    <div className="detail-toolbar"><button className="back-button" onClick={onBack}><ArrowLeft size={19} /> Retos terminados</button></div>
    <section className={`finish-cover simple-finish finish-${story.scenario}`} aria-labelledby="finish-title"><div className="finish-copy"><p className="simple-meta">{c.title}</p><h1 id="finish-title">{story.title}</h1><p className="simple-meta">{shortDate(c.startDate)} — {shortDate(c.endDate)}</p></div>{story.showCelebration && <FinishArt shared={story.scenario === 'tie'} animate={firstVisit || replay > 0} replay={replay} />}</section>
    <div className="finish-columns simple-finish-columns">
      <section className={`prize-finish-card simple-prize-card prize-${story.prize.state}`} aria-labelledby="prize-finish-title"><div className="section-heading"><span className="simple-meta">Premio</span><span className="prize-state">{story.prize.state === 'delivered' ? 'Recibido' : story.prize.state === 'pending' ? 'Pendiente' : 'Por acordar'}</span></div><h2 id="prize-finish-title">{c.prize || 'Sin premio'}</h2>
        {payers.length > 0 && recipients.length > 0 ? <div className="prize-handoff"><div><span>Entrega</span><strong>{payers.join(', ')}</strong></div><ArrowRight size={20} /><div><span>Recibe</span><strong>{recipients.join(', ')}</strong></div></div> : story.prize.state !== 'delivered' && <p className="simple-prize-note">{story.prize.state === 'unresolved' ? 'El grupo acuerda qué hacer con el premio.' : story.prize.state === 'none' ? 'Este reto no tiene un premio escrito.' : result.prizeRule === 'creator' && !result.hasRedactions ? 'Ganó quien invita. El premio se queda en casa.' : 'Coordinen la entrega con quien ganó.'}</p>}
        {story.prize.state === 'delivered' ? <p className="simple-receipt" role="status"><CheckCheck size={20} /> Recibido el {receivedDate}</p> : story.prize.canMarkReceived && <div className="receipt-action">{confirmReceipt ? <div className="receipt-confirm"><p>¿Ya recibiste el premio?</p><div><button className="button dark" disabled={busy} onClick={onReceive}>{busy ? 'Guardando…' : 'Confirmar'}<Check size={18} /></button><button className="text-button" disabled={busy} onClick={() => setConfirmReceipt(false)}>Cancelar</button></div></div> : <button className="button dark full" disabled={busy} onClick={() => setConfirmReceipt(true)}>Ya recibí mi premio <Check size={18} /></button>}</div>}
      </section>
      <section className="simple-ranking" aria-label="Clasificación final"><div className="section-heading"><h2>Resultado final</h2></div><RankingList rows={story.rankedRows} userId={userId} />{(result.hasMissingData || result.hasRedactions || result.outcome === 'solo' || result.outcome === 'no_data' || result.outcome === 'tie') && <p className="simple-result-note">{result.hasRedactions ? 'Alguien retiró sus datos. No se reasigna la victoria.' : result.outcome === 'incomplete' ? 'Faltan datos de participantes. No asignamos ganador.' : result.outcome === 'tie' ? 'Empate. El premio se acuerda en grupo.' : result.outcome === 'solo' ? 'Terminó con una sola persona. Sin ganador de grupo.' : 'No hay pasos suficientes para asignar ganador.'}</p>}</section>
    </div>
    <details className="simple-details"><summary>Más opciones <ChevronDown size={18} /></summary><div className="simple-options"><button className="text-button" onClick={onRematch}><RotateCcw size={19} /> Preparar la revancha</button><button className="text-button" disabled={busy} onClick={() => onCopy(shareText)}><Copy size={19} /> Copiar resultado</button>{story.showCelebration && <button className="text-button" disabled={busy} onClick={() => setReplay(n => n + 1)}><Sparkles size={19} /> Volver a celebrar</button>}<details className="simple-details"><summary>Cómo se calcula <ChevronDown size={18} /></summary><div><p>Pasos recibidos antes de terminar el último día en {c.timeZone}. Los envíos posteriores no cambian el resultado.</p><p>«—» significa sin datos, no cero. {story.resultNote}</p><p>{story.prize.description}</p><p>Ritmo no realiza pagos ni entregas.</p></div></details><button className="text-button danger-text" onClick={onLeave} disabled={busy}>{c.ownerId === userId ? 'Eliminar reto' : 'Salir del reto'}</button></div></details>
  </>;
}
