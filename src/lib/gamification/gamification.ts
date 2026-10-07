import { badRequest } from '../errors.ts';

export type LevelDef = { number: number; title: string; minXp: number };

export function calculateLevel(totalXp: number, levels: readonly LevelDef[]) {
  if (levels.length === 0) throw new Error('No levels configured');
  const xp = Math.max(0, Math.floor(totalXp));
  const sorted = [...levels].sort((a, b) => a.minXp - b.minXp);
  let current: LevelDef | null = null;
  let next: LevelDef | null = null;
  for (const l of sorted) {
    if (l.minXp <= xp) current = l;
    else { next = l; break; }
  }
  if (!current) throw new Error('Level table must include a level with minXp 0');
  const span = next ? next.minXp - current.minXp : null;
  const into = xp - current.minXp;
  return {
    level: current.number, title: current.title, totalXp: xp, xpIntoLevel: into,
    xpForNextLevel: span, progressPct: span ? Math.floor((into / span) * 100) : 100,
  };
}

export type StreakState = { currentDays: number; longestDays: number; lastActivityDate: string | null };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayNum = (s: string) => {
  if (!DAY_RE.test(s)) throw badRequest(`Invalid date "${s}", expected YYYY-MM-DD`);
  const [y, m, d] = s.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** `today` is the learner's local calendar day (YYYY-MM-DD), computed server-side from their profile timezone. */
export function updateStreak(state: StreakState, today: string): StreakState {
  const t = dayNum(today);
  if (state.lastActivityDate === null) return { currentDays: 1, longestDays: Math.max(1, state.longestDays), lastActivityDate: today };
  const diff = t - dayNum(state.lastActivityDate);
  if (diff <= 0) return { ...state }; // same day, or clock skew: no change
  const currentDays = diff === 1 ? state.currentDays + 1 : 1;
  return { currentDays, longestDays: Math.max(state.longestDays, currentDays), lastActivityDate: today };
}

export const xpIdempotencyKey = (source: string, userId: string, refId: string) => `${source}:${userId}:${refId}`;

export function assertValidXpAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10_000) throw badRequest('Invalid XP amount');
}
