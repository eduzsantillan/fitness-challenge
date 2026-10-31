import { Footprints, Gift, Sparkles } from 'lucide-react';
export function Brand() { return <span className="brand"><span className="brand-symbol"><Footprints size={21} strokeWidth={2.1} /></span>ritmo<span className="brand-period">.</span></span>; }
export function Avatar({ name, index = 0, small = false }: { name: string; index?: number; small?: boolean }) {
  return <span aria-hidden="true" className={`avatar tone-${index % 5}${small ? ' avatar-small' : ''}`}>{Array.from(name.trim() || '?')[0]!.toUpperCase()}</span>;
}
export function PrizeArt({ compact = false }: { compact?: boolean }) {
  return <div className={`prize-art${compact ? ' compact' : ''}`} aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-star star-one">✳</span><span className="art-star star-two">✦</span><span className="art-gift"><Gift size={compact ? 46 : 70} strokeWidth={1.25} /></span><span className="art-step"><Footprints size={23} strokeWidth={1.65} /></span><Sparkles className="art-spark" size={24} strokeWidth={1.5} /></div>;
}
export function Loading({ text = 'Un momento…' }: { text?: string }) { return <div className="loading" role="status"><span className="loader" />{text}</div>; }

/** The same readable, sparse ranking on active and finished challenges. */
export function RankingList({ rows, userId }: { rows: readonly { userId: string; displayName: string; steps: number | null; rank: number | null; isWinner?: boolean }[]; userId: string }) {
  return <ol className="simple-ranking-list">{rows.map((row, i) => <li className={row.userId === userId ? 'is-you' : ''} key={row.userId}><span className="simple-rank" aria-label={row.isWinner ? 'Ganador' : row.rank === null ? 'Sin puesto' : `Puesto ${row.rank}`}>{row.isWinner ? '★' : row.rank ?? '—'}</span><Avatar name={row.displayName} index={i} /><span className="simple-person">{row.displayName}{row.userId === userId && <small>tú</small>}</span><span className="simple-steps"><strong>{row.steps === null ? '—' : new Intl.NumberFormat('es-ES').format(row.steps)}</strong><span>{row.steps === null ? 'sin datos' : 'pasos'}</span></span></li>)}</ol>;
}
