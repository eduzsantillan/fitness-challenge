import { useState, type FormEvent } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { login } from './auth';
import { Field } from './components';
export function AuthForm({ onSuccess, initialRegister = false }: { onSuccess: () => void; initialRegister?: boolean }) {
  const [register, setRegister] = useState(initialRegister), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const f = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await login(String(f.get('email')), String(f.get('password')), register ? String(f.get('name')) : undefined); onSuccess(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo entrar.'); } finally { setBusy(false); }
  }
  return <><div className="auth-tabs" role="group" aria-label="Tipo de acceso"><button type="button" className={!register ? 'selected' : ''} aria-pressed={!register} disabled={busy} onClick={() => { setRegister(false); setError(''); }}>Entrar</button><button type="button" className={register ? 'selected' : ''} aria-pressed={register} disabled={busy} onClick={() => { setRegister(true); setError(''); }}>Crear cuenta</button></div>
    <p>{register ? 'Tu espacio para moverte con los tuyos. No necesitas una cuenta de Apple para registrarte.' : 'Vuelve a tu reto. Tu progreso te espera.'}</p>
    <form onSubmit={e => void submit(e)}>{error && <div className="banner error" role="alert">{error}</div>}
      {register && <Field label="Tu nombre" name="name" autoComplete="name" maxLength={40} required />}
      <Field label="Email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} required />
      <Field label="Contraseña" name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 12 : undefined} maxLength={128} required />
      {register && <small className="helper">Al menos 12 caracteres. Usa una contraseña distinta a la de Apple.</small>}
      <button className="button primary full" disabled={busy}>{busy ? 'Un momento…' : register ? 'Crear mi cuenta' : 'Entrar a mi cuenta'}<ArrowRight size={17} /></button>
    </form><div className="privacy-note"><ShieldCheck size={18} /><p>Piloto privado: el email no se verifica y aún no hay recuperación de contraseña por correo. Guarda tu contraseña en un gestor.</p></div></>;
}
