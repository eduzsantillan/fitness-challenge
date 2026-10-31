import { Footprints, Gift, Sparkles } from 'lucide-react';
export function Brand() { return <span className="brand"><span className="brand-symbol"><Footprints size={21} strokeWidth={2.1} /></span>ritmo<span className="brand-period">.</span></span>; }
export function Avatar({ name, index = 0, small = false }: { name: string; index?: number; small?: boolean }) {
  return <span aria-hidden="true" className={`avatar tone-${index % 5}${small ? ' avatar-small' : ''}`}>{Array.from(name.trim() || '?')[0]!.toUpperCase()}</span>;
}
export function PrizeArt({ compact = false }: { compact?: boolean }) {
  return <div className={`prize-art${compact ? ' compact' : ''}`} aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-star star-one">✳</span><span className="art-star star-two">✦</span><span className="art-gift"><Gift size={compact ? 46 : 70} strokeWidth={1.25} /></span><span className="art-step"><Footprints size={23} strokeWidth={1.65} /></span><Sparkles className="art-spark" size={24} strokeWidth={1.5} /></div>;
}
export function Loading({ text = 'Un momento…' }: { text?: string }) { return <div className="loading" role="status"><span className="loader" />{text}</div>; }
