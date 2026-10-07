// Central effective-access engine. Pure: callers load rows from the DB and pass `now` explicitly.
// Rules (documented in docs/DATABASE_ARCHITECTURE.md when written):
//  - Subscription counts only if status is ACTIVE/TRIALING, its period has started and not ended,
//    and (for TRIALING) trialEndsAt has not passed. PAST_DUE, CANCELED and EXPIRED grant nothing.
//  - Grant counts only if not revoked, started, and (UNLIMITED, or TIMED with expiresAt in the future).
//    A TIMED grant with no expiresAt is malformed and ignored.
//  - The best candidate wins: premium beats non-premium, then higher AI limit (null = unlimited),
//    then later expiry (null = never), then subscription over grant.
//  - Falls back to the FREE plan. Suspended/deleted accounts get no access at all.

export type PlanInfo = {
  code: string;
  grantsPremiumAccess: boolean;
  aiDailyMessageLimit: number | null; // null = unlimited
  features?: Record<string, unknown> | null;
};
export type SubscriptionInfo = {
  id: string;
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  plan: PlanInfo;
};
export type GrantInfo = {
  id: string;
  type: 'TIMED' | 'UNLIMITED';
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  plan: PlanInfo | null; // null = full premium, unlimited AI
};
export type AccessSource = 'GRANT' | 'SUBSCRIPTION' | 'FREE' | 'NONE';
export type EffectiveAccess = {
  hasAccess: boolean;
  hasPremiumAccess: boolean;
  source: AccessSource;
  sourceId: string | null;
  planCode: string | null;
  expiresAt: Date | null;
  neverExpires: boolean;
  aiDailyMessageLimit: number | null;
  features: Record<string, unknown>;
};

type Candidate = {
  source: 'GRANT' | 'SUBSCRIPTION';
  sourceId: string;
  plan: PlanInfo | null;
  premium: boolean;
  aiLimit: number | null;
  expiresAt: Date | null;
};

export function isSubscriptionActive(s: SubscriptionInfo, now: Date): boolean {
  if (s.status !== 'ACTIVE' && s.status !== 'TRIALING') return false;
  if (s.currentPeriodStart > now) return false;
  if (s.currentPeriodEnd && now >= s.currentPeriodEnd) return false;
  if (s.status === 'TRIALING' && s.trialEndsAt && now >= s.trialEndsAt) return false;
  return true;
}

export function isGrantActive(g: GrantInfo, now: Date): boolean {
  if (g.revokedAt && g.revokedAt <= now) return false;
  if (g.startsAt > now) return false;
  if (g.type === 'UNLIMITED') return true;
  return g.expiresAt !== null && now < g.expiresAt;
}

const t = (d: Date | null) => (d === null ? Number.POSITIVE_INFINITY : d.getTime());
const lim = (n: number | null) => (n === null ? Number.POSITIVE_INFINITY : n);

function better(a: Candidate, b: Candidate): boolean {
  if (a.premium !== b.premium) return a.premium;
  if (lim(a.aiLimit) !== lim(b.aiLimit)) return lim(a.aiLimit) > lim(b.aiLimit);
  if (t(a.expiresAt) !== t(b.expiresAt)) return t(a.expiresAt) > t(b.expiresAt);
  return a.source === 'SUBSCRIPTION' && b.source !== 'SUBSCRIPTION';
}

export function computeEffectiveAccess(input: {
  accountActive: boolean;
  subscriptions: readonly SubscriptionInfo[];
  grants: readonly GrantInfo[];
  freePlan: PlanInfo | null;
  now: Date;
}): EffectiveAccess {
  const { accountActive, subscriptions, grants, freePlan, now } = input;
  if (!accountActive) {
    return { hasAccess: false, hasPremiumAccess: false, source: 'NONE', sourceId: null, planCode: null,
      expiresAt: null, neverExpires: false, aiDailyMessageLimit: 0, features: {} };
  }
  const candidates: Candidate[] = [];
  for (const s of subscriptions) {
    if (!isSubscriptionActive(s, now)) continue;
    let exp = s.currentPeriodEnd;
    if (s.status === 'TRIALING' && s.trialEndsAt && (exp === null || s.trialEndsAt < exp)) exp = s.trialEndsAt;
    candidates.push({ source: 'SUBSCRIPTION', sourceId: s.id, plan: s.plan,
      premium: s.plan.grantsPremiumAccess, aiLimit: s.plan.aiDailyMessageLimit, expiresAt: exp });
  }
  for (const g of grants) {
    if (!isGrantActive(g, now)) continue;
    candidates.push({ source: 'GRANT', sourceId: g.id, plan: g.plan,
      premium: g.plan ? g.plan.grantsPremiumAccess : true,
      aiLimit: g.plan ? g.plan.aiDailyMessageLimit : null,
      expiresAt: g.type === 'UNLIMITED' ? null : g.expiresAt });
  }
  let best: Candidate | null = null;
  for (const c of candidates) if (best === null || better(c, best)) best = c;

  if (best) {
    return { hasAccess: true, hasPremiumAccess: best.premium, source: best.source, sourceId: best.sourceId,
      planCode: best.plan?.code ?? null, expiresAt: best.expiresAt, neverExpires: best.expiresAt === null,
      aiDailyMessageLimit: best.aiLimit, features: { ...(best.plan?.features ?? {}) } };
  }
  if (freePlan) {
    return { hasAccess: true, hasPremiumAccess: freePlan.grantsPremiumAccess, source: 'FREE', sourceId: null,
      planCode: freePlan.code, expiresAt: null, neverExpires: true,
      aiDailyMessageLimit: freePlan.aiDailyMessageLimit, features: { ...(freePlan.features ?? {}) } };
  }
  return { hasAccess: true, hasPremiumAccess: false, source: 'NONE', sourceId: null, planCode: null,
    expiresAt: null, neverExpires: true, aiDailyMessageLimit: 0, features: {} };
}

/** Whether another AI message is allowed today. usedToday comes from ai_usage. */
export function canUseAi(access: EffectiveAccess, usedToday: number): boolean {
  if (!access.hasAccess) return false;
  return access.aiDailyMessageLimit === null || usedToday < access.aiDailyMessageLimit;
}
