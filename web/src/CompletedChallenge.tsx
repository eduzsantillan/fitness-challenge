import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, ChevronDown, Copy, Flag, Footprints, Gift, HeartHandshake, RotateCcw, Sparkles, Trophy, Users } from 'lucide-react';
import { getCompletionPresentation } from './completion-helpers';
import { number, shortDate } from './dates';
import { Avatar } from './ui';
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
  const duration = Math.round((Date.parse(c.endDate) - Date.parse(c.startDate)) / 86400000) + 1;
  const people = (ids: readonly string[]) => ids.map(id => board.rows.find(row => row.userId === id)?.displayName).filter((name): name is string => Boolean(name));
  const payers = people(story.prize.payerIds), recipients = people(story.prize.recipientIds);
  const receivedDate = result.receivedAt ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', timeZone: c.timeZone }).format(new Date(result.receivedAt)) : '';
  const winnerNames = story.winners.map(row => row.displayName).join(' y ');
  const shareText = `${c.title} · ${shortDate(c.startDate)} — ${shortDate(c.endDate)}\n${story.title}\n${board.rows.filter(r => r.steps !== null).map(r => `${r.displayName}: ${number(r.steps)} pasos recibidos`).join('\n')}${c.prize ? `\nPremio: ${c.prize}` : ''}\nRitmo · Lo bueno fue caminar juntos.`;
  return <>
    <div className="detail-toolbar"><button className="back-button" onClick={onBack}><ArrowLeft size={18} /> Retos terminados</button><span className="closed-label"><Flag size={14} /> Resultado guardado</span></div>
    <section className={`finish-cover finish-${story.scenario}`} aria-labelledby="finish-title">
      <div className="finish-copy"><p className="eyebrow"><span className="tiny-dot" /> {story.eyebrow}</p><h1 id="finish-title">{story.title}</h1><p className="finish-challenge-name">{c.title} <span>· {shortDate(c.startDate)} — {shortDate(c.endDate)}</span></p><p className="finish-message">{story.message}</p>
        {story.showCelebration && <button className="celebrate-again" onClick={() => { if (!busy) setReplay(n => n + 1); }} disabled={busy}><Sparkles size={15} /> Volver a celebrar</button>}
      </div>
      <FinishArt shared={story.scenario === 'tie'} animate={story.showCelebration && (firstVisit || replay > 0)} replay={replay} />
      <div className="finish-memory"><span><Footprints size={17} /><strong>{number(story.groupSteps)}</strong> pasos recibidos entre todos</span><span>{duration} {duration === 1 ? 'día' : 'días'} <i /> {board.rows.length} {board.rows.length === 1 ? 'persona' : 'personas'} <i /> Un buen motivo.</span></div>
    </section>
    <div className="finish-columns">
      <section className="final-ranking" aria-labelledby="final-ranking-title"><div className="section-heading"><div><p className="eyebrow">01 · LA FOTO FINAL</p><h2 id="final-ranking-title">Así quedó la historia.</h2></div><span className="final-seal"><CheckCheck size={20} /></span></div>
        <ol className="ranking-list final-ranking-list">{story.rankedRows.map((r, index) => {
          const place = r.rank;
          const awarded = r.isWinner;
          return <li key={r.userId} className={`${r.userId === userId ? 'is-you ' : ''}${awarded ? 'final-winner' : ''}`}><div className="rank-number">{awarded ? <Trophy size={18} /> : place ?? '—'}</div><Avatar name={r.displayName} index={index} /><div className="rank-person"><strong>{r.displayName}{r.userId === userId && <span className="you-label">tú</span>}</strong><span>{awarded ? result.outcome === 'tie' ? 'Primer puesto compartido' : 'Primer puesto' : r.steps === null ? 'Sin pasos registrados al cierre' : 'También le ganó al sofá'}</span></div><div className="rank-total"><strong>{number(r.steps)}</strong><span>{r.steps === null ? 'sin datos' : 'pasos'}</span></div></li>;
        })}</ol><p className="result-note">{story.resultNote}</p>
        <details className="finish-rules"><summary>Cómo cerramos el marcador <ChevronDown size={15} /></summary><div><p>El último día cuenta completo. Cerramos al llegar la medianoche siguiente, en {c.timeZone}. Solo cuentan los pasos recibidos antes de ese momento y desde que cada persona se unió.</p><p>El resultado se guarda: los envíos posteriores no cambian esta clasificación. Son pasos recibidos, no una verificación de toda la actividad del grupo. Un «—» no equivale a cero.</p><p>Un empate, un reto en solitario o datos insuficientes no asignan el premio automáticamente.</p>{result.hasRedactions && <p>Alguien salió o borró sus datos. Ocultamos su información sin volver a decidir quién ganó.</p>}</div></details>
      </section>
      <section className={`prize-finish-card prize-${story.prize.state}`} aria-labelledby="prize-finish-title"><p className="eyebrow">02 · EL BUEN PLAN</p><div className="prize-heading"><span className="prize-finish-icon">{story.prize.state === 'delivered' ? <CheckCheck size={24} /> : <Gift size={24} strokeWidth={1.5} />}</span><span className={`prize-state ${story.prize.state === 'delivered' ? 'delivered' : ''}`}>{story.prize.state === 'delivered' ? 'Recibido' : story.prize.state === 'pending' ? 'Pendiente' : 'Por coordinar'}</span></div><h2 id="prize-finish-title">{c.prize || 'El orgullo de haber participado.'}</h2><p className="prize-story-title">{story.prize.title}</p><p className="prize-description">{story.prize.description}</p>
        {payers.length > 0 && recipients.length > 0 && story.prize.state === 'pending' && <div className="prize-handoff"><div><span>LO PREPARA{payers.length > 1 ? 'N' : ''}</span><strong>{payers.join(', ')}</strong></div><ArrowRight size={17} /><div><span>LO DISFRUTA</span><strong>{recipients.join(', ')}</strong></div></div>}
        {story.prize.state === 'delivered' ? <div className="receipt-note" role="status"><span className="receipt-check"><Check size={17} /></span><p><strong>Buen plan, cumplido.</strong><span>{result.winnerUserIds.includes(userId) ? 'Confirmaste la recepción' : `${winnerNames || 'Quien ganó'} confirmó la recepción`} el {receivedDate}.</span></p></div> : story.prize.canMarkReceived ? <div className="receipt-action">{confirmReceipt ? <div className="receipt-confirm"><p>¿El premio ya está en tus manos?</p><span>Al confirmarlo, el grupo lo verá como recibido. Ritmo no hace pagos ni entregas.</span><div><button className="button dark small" disabled={busy} onClick={onReceive}>{busy ? 'Guardando…' : 'Sí, ya lo recibí'}<Check size={16} /></button><button className="text-button" disabled={busy} onClick={() => setConfirmReceipt(false)}>Todavía no</button></div></div> : <><button className="button dark full" disabled={busy} onClick={() => setConfirmReceipt(true)}>Ya recibí mi premio <Check size={17} /></button><small>Solo tú, que ganaste, puedes confirmarlo.</small></>}</div> : story.prize.state === 'pending' && <p className="prize-wait-note"><HeartHandshake size={17} /> Quien ganó lo marcará como recibido. Sin prisas, pero sin hacerse el sofá.</p>}
        <div className="prize-card-footer"><span><Check size={14} /> Reto cerrado</span><span className={story.prize.state === 'delivered' ? 'is-done' : ''}>{story.prize.state === 'delivered' ? <Check size={14} /> : <span className="small-ring" />}{story.prize.state === 'delivered' ? 'Premio recibido' : 'El siguiente buen plan'}</span></div>
      </section>
    </div>
    <section className="rematch-note"><div className="rematch-symbol"><RotateCcw size={23} strokeWidth={1.5} /></div><div><p className="eyebrow">LOS CRÉDITOS NO SON EL FINAL</p><h2>¿Y si repetimos <em>la parte buena?</em></h2><p>Mismo buen motivo. Un marcador nuevo. Nadie se une sin aceptar.</p></div><button className="button primary" onClick={onRematch}>Preparar la revancha <ArrowRight size={17} /></button></section>
    <div className="detail-footer finish-footer"><button className="text-button" onClick={() => onCopy(shareText)}><Copy size={15} /> Copiar resumen del reto</button><button className="text-button muted" onClick={onLeave} disabled={busy}>{c.ownerId === userId ? 'Eliminar reto' : 'Salir del reto'}</button></div>
  </>;
}
