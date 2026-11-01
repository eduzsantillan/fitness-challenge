import { locale } from './i18n';
import type { Activity } from './types';
export function dateKey(date = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export const addDays = (date: string, count: number) => new Date(Date.parse(`${date}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
export function monday(date: string) { const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return addDays(date, -((day + 6) % 7)); }
export function week(date: string, offset = 0) { const start = addDays(monday(date), offset * 7); return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }
export function sum(days: Activity[], metric: 'steps' | 'workoutSeconds'): number | null {
  const values = days.flatMap(day => day[metric] === null ? [] : [day[metric]!]);
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}
export const number = (value: number | null) => value === null ? '—' : new Intl.NumberFormat(locale()).format(value);
export function duration(value: number | null) {
  if (value === null) return '—';
  const minutes = Math.floor(value / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}
export const shortDate = (date: string) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
