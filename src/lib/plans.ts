// Plan definitions — 4 tiers with metered limits.
// ------------------------------------------------------------------
// Each plan defines hard limits on metered resources. The billing helper
// (billing.ts) uses these to enforce limits BEFORE expensive operations run.

export type PlanId = 'free' | 'pro' | 'business' | 'enterprise'
export type UsageMetric =
  | 'projects'
  | 'llm_tokens'
  | 'businesses'
  | 'godmode_goals'
  | 'images'
  | 'deployments'

export interface Plan {
  id: PlanId
  name: string
  priceMonthly: number
  priceYearly: number
  tagline: string
  limits: Record<UsageMetric, number> // -1 = unlimited
  features: string[]
  highlighted?: boolean
  cta: string
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    tagline: 'For trying things out',
    limits: {
      projects: 3,
      llm_tokens: 50_000,
      businesses: 1,
      godmode_goals: 3,
      images: 10,
      deployments: 5,
    },
    features: [
      '3 projects',
      '50K AI credits / month',
      '1 business launch',
      '3 God Mode goals',
      '10 AI-generated images',
    ],
    cta: 'Start free',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 19,
    priceYearly: 190,
    tagline: 'For freelancers & indie hackers',
    limits: {
      projects: 25,
      llm_tokens: 1_000_000,
      businesses: 10,
      godmode_goals: 50,
      images: 200,
      deployments: 100,
    },
    features: [
      '25 projects',
      '1M AI credits / month',
      '10 business launches',
      '50 God Mode goals',
      '200 AI-generated images',
      'Priority support',
    ],
    highlighted: true,
    cta: 'Upgrade to Pro',
  },
  business: {
    id: 'business',
    name: 'Business',
    priceMonthly: 79,
    priceYearly: 790,
    tagline: 'For teams & agencies',
    limits: {
      projects: 100,
      llm_tokens: 5_000_000,
      businesses: 50,
      godmode_goals: 500,
      images: 1_000,
      deployments: 1_000,
    },
    features: [
      '100 projects',
      '5M AI credits / month',
      '50 business launches',
      '500 God Mode goals',
      '1,000 AI-generated images',
      'Team collaboration',
    ],
    cta: 'Upgrade to Business',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 299,
    priceYearly: 2990,
    tagline: 'For high-volume orgs',
    limits: {
      projects: -1,
      llm_tokens: -1,
      businesses: -1,
      godmode_goals: -1,
      images: -1,
      deployments: -1,
    },
    features: [
      'Unlimited everything',
      'Dedicated infrastructure',
      'SSO + audit log export',
      'Custom integrations',
      'SLA + dedicated CSM',
    ],
    cta: 'Contact sales',
  },
}

export const PLAN_LIST: Plan[] = [PLANS.free, PLANS.pro, PLANS.business, PLANS.enterprise]

export function getPlan(planId: string): Plan {
  return PLANS[planId as PlanId] || PLANS.free
}
