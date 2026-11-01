import { useSyncExternalStore } from 'react';
import translations from './translations.json';
export type Language = 'es' | 'en';
let language: Language = 'es';
try { if (typeof localStorage !== 'undefined' && localStorage.getItem('ritmo:language') === 'en') language = 'en'; } catch { /* Storage may be disabled. */ }
const listeners = new Set<() => void>();
export const locale = () => language === 'en' ? 'en-CA' : 'es-ES';
export function setLanguage(value: Language) {
  language = value;
  try { localStorage.setItem('ritmo:language', value); } catch { /* Still works without persistence. */ }
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  listeners.forEach(notify => notify());
}
export function useLanguage() { return useSyncExternalStore(notify => { listeners.add(notify); return () => listeners.delete(notify); }, () => language, () => language); }
/** Only application copy is translated. User names, prizes and titles never enter this function. */
export function t(source: string, values: readonly unknown[] = []): string {
  const text = language === 'en' ? (translations as Record<string,string>)[source] ?? source : source;
  return text.replace(/\{(\d+)\}/g, (match, index: string) => Number(index) < values.length ? String(values[Number(index)]) : match);
}
export function LanguagePicker() {
  const selected = useLanguage();
  return <label className="language-picker"><span>{selected === 'en' ? 'Language' : 'Idioma'}</span><select value={selected} onChange={e => setLanguage(e.target.value as Language)}><option value="es">Español</option><option value="en">English</option></select></label>;
}

export function errorText(message: string): string {
  if (language === 'es') return message;
  const translated = t(message);
  // Server validation is still Spanish. Never expose raw internal errors as English copy.
  return translated !== message || !/[áéíóúñ¿¡]|\b(No|El|La|Los|Las|Inicia|Falta|Revisa|Envía|Código|Primero)\b/.test(message) ? translated : "We couldn't complete that. Check your connection and try again.";
}
