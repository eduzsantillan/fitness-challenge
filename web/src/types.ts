import type { Activity, Challenge, BoardRow } from '../../backend/src/model.js';
import type { CompletionResult } from './completion-helpers';
export type { Activity, Challenge };
export type Profile = { userId: string; displayName: string; userCode?: string; timeZone?: string | null };
export type PersonalDay = { date: string; steps: number | null; capturedAt?: string; syncedAt?: string };
export type PrizeRule = 'others' | 'creator' | 'coordinate';
export type InvitePreview = { challenge: Pick<Challenge, 'id' | 'title' | 'startDate' | 'endDate' | 'timeZone'> & { prize?: string; prizeRule?: PrizeRule }; creator: { displayName: string }; members: { displayName: string }[] };
export type Row = BoardRow;
export type Board = { challenge: Challenge; rows: Row[]; result?: CompletionResult | null };
export interface Client { request<T>(path: string, method?: string, body?: unknown): Promise<T> }
