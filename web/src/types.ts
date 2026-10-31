import type { Activity, Challenge } from '../../backend/src/model.js';
export type { Activity, Challenge };
export type Profile = { userId: string; displayName: string };
export type Row = { userId: string; displayName: string; steps: number | null; workoutSeconds: number | null; days: Activity[] };
export type Board = { challenge: Challenge; rows: Row[] };
export interface Client { request<T>(path: string, method?: string, body?: unknown): Promise<T> }
