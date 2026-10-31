import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, CircleHelp, Copy, Footprints, X } from 'lucide-react';
import { duration, number, shortDate } from './dates';
import type { Activity, Challenge } from './types';

export function Metric({ title, value, unit, icon, tone, subtitle, goal, current }: { title: string; value: string; unit?: string; icon: ReactNode; tone: string; subtitle: string; goal: number; current: number | null }) {
  return <article className={`card metric-card ${tone}`}><div className="metric-top"><span>{title}</span><span className={`icon-box ${tone}`}>{icon}</span></div><div className="metric-value">{value}<small>{unit}</small></div><div className="metric-progress"><div style={{ width: `${Math.min((current ?? 0) / goal * 100, 100)}%` }} /></div><p>{subtitle}</p></article>;
}
export function WeeklyChart({ days, dates, today }: { days: Activity[]; dates: string[]; today: string }) {
  const max = Math.max(14000, ...days.map(d => d.steps ?? 0));
  return <div className="weekly-chart"><div className="chart-y"><span>{number(max)}</span><span>{number(Math.round(max / 2))}</span><span>0</span></div><div className="chart-plot"><div className="chart-grid"><i /><i /><i /></div><div className="goal-line" style={{ bottom: `calc(24px + (100% - 24px) * ${10000 / max})` }} /><div className="bars">{dates.map(date => {
    const value = days.find(d => d.date === date)?.steps ?? null;
    return <div className="bar-column" key={date}><div className="bar-track"><div title={`${shortDate(date)}: ${value === null ? 'sin datos' : `${number(value)} pasos`}`} className={`bar ${date === today ? 'today' : ''} ${value === null ? 'missing' : ''}`} style={{ height: value === null ? '3px' : `${Math.max(value / max * 100, 1)}%` }} /><span className="bar-tooltip">{value === null ? 'Sin datos' : number(value)}</span></div><span className={date === today ? 'today-label' : ''}>{new Intl.DateTimeFormat('es', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)).replace('.', '')}</span></div>;
  })}</div></div></div>;
}
export function Empty({ text }: { text: string }) { return <div className="empty"><Footprints size={26} /><p>{text}</p></div>; }
export function Consent() { return <label className="consent"><input type="checkbox" name="consent" required /><span>Acepto compartir mis totales diarios de pasos y entrenamiento con los participantes de este reto durante su periodo. No se comparte el resto de mis datos de Salud.</span></label>; }
export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) { return <label className="form-field"><span>{label}</span><input {...props} /></label>; }
export function ConfigField({ label, value, secret, onCopy }: { label: string; value: string; secret?: boolean; onCopy?: () => void }) {
  const [visible, setVisible] = useState(false);
  return <div className="config-field"><label>{label}</label><div><code>{secret && !visible ? '••••••••••••••••••••••••••' : value}</code>{secret && <button className="text-button" onClick={() => setVisible(v => !v)}>{visible ? 'Ocultar' : 'Ver'}</button>}{onCopy && <button onClick={onCopy} aria-label={`Copiar ${label}`}><Copy size={16} /></button>}</div></div>;
}
export function ActivityForm({ current, days, today, busy, onSave }: { current: Challenge; days: Activity[]; today: string; busy: boolean; onSave: (day: Activity) => Promise<void> }) {
  const initial = today < current.startDate ? current.startDate : today > current.endDate ? current.endDate : today;
  const [date, setDate] = useState(initial), [steps, setSteps] = useState(''), [minutes, setMinutes] = useState('');
  useEffect(() => { const day = days.find(d => d.date === date); setSteps(day?.steps == null ? '' : String(day.steps)); setMinutes(day?.workoutSeconds == null ? '' : String(day.workoutSeconds / 60)); }, [date, days]);
  function save(e: FormEvent) {
    e.preventDefault(); void onSave({ date, steps: steps === '' ? null : Number(steps), workoutSeconds: minutes === '' ? null : Math.round(Number(minutes) * 60), capturedAt: new Date().toISOString(), syncedAt: new Date().toISOString(), source: 'manual' });
  }
  return <form onSubmit={save}><p>Lee los pasos en Salud y la duración de los entrenamientos guardados en Fitness. Un campo vacío significa <strong>sin datos</strong>, no cero.</p><Field label={`Día · ${current.timeZone}`} type="date" value={date} min={current.startDate} max={today < current.endDate ? today : current.endDate} required onChange={e => setDate(e.target.value)} /><div className="form-row"><Field label="Pasos" type="number" inputMode="numeric" min={0} max={250000} step={1} placeholder="Ej. 8642" value={steps} onChange={e => setSteps(e.target.value)} /><Field label="Entrenamientos · minutos" type="number" inputMode="decimal" min={0} max={1560} step="any" placeholder="Ej. 42" value={minutes} onChange={e => setMinutes(e.target.value)} /></div><div className="honest-note"><CircleHelp size={18} /><span>Se suman las duraciones de los entrenamientos guardados. No copies el tiempo del anillo Ejercicio: es otra métrica. Este registro se identifica como manual.</span></div><button className="button primary full" disabled={busy}>{busy ? 'Guardando…' : 'Guardar actividad'}<Check size={17} /></button></form>;
}
export function ModalFrame({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => { node?.close(); }; }, []);
  return <dialog ref={dialog} className="modal" onCancel={onClose} onClick={e => { if (e.target === dialog.current) onClose(); }} aria-labelledby="modal-title"><div className="modal-content"><button className="modal-close" onClick={onClose} aria-label="Cerrar ventana"><X size={20} /></button><h2 id="modal-title">{title}</h2>{children}</div></dialog>;
}
