'use client'

// BillingView — the user's billing dashboard.
// ------------------------------------------------------------------
// Shows:
//   - Current plan card (name, price, status)
//   - Usage meters for every metered metric (used / limit, progress bar)
//   - Plan comparison table (Free / Pro / Business / Enterprise)
//   - Upgrade/downgrade buttons

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  CreditCard,
  Crown,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Loader2,
  Rocket,
  Sparkles,
  Zap,
  Building2,
  Briefcase,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const METRIC_META: Record<string, { label: string; icon: React.ReactNode; accent: string }> = {
  projects: { label: 'Projects', icon: <Rocket className="h-4 w-4" />, accent: 'text-emerald-600 dark:text-emerald-300' },
  llm_tokens: { label: 'LLM Tokens', icon: <Sparkles className="h-4 w-4" />, accent: 'text-violet-600 dark:text-violet-300' },
  businesses: { label: 'Businesses', icon: <Building2 className="h-4 w-4" />, accent: 'text-teal-600 dark:text-teal-300' },
  godmode_goals: { label: 'God Mode Goals', icon: <Zap className="h-4 w-4" />, accent: 'text-fuchsia-600 dark:text-fuchsia-300' },
  images: { label: 'AI Images', icon: <ImageIcon className="h-4 w-4" />, accent: 'text-rose-600 dark:text-rose-300' },
  deployments: { label: 'Deployments', icon: <Briefcase className="h-4 w-4" />, accent: 'text-sky-600 dark:text-sky-300' },
}

const METRIC_ORDER = ['projects', 'llm_tokens', 'businesses', 'godmode_goals', 'images', 'deployments']

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return n.toString()
}

export default function BillingView() {
  const [usage, setUsage] = React.useState<{
    plan: { id: string; name: string; priceMonthly: number; tagline: string; features: string[]; highlighted?: boolean; cta: string }
    usage: Record<string, { used: number; limit: number; unlimited: boolean }>
  } | null>(null)
  const [plans, setPlans] = React.useState<{
    id: string; name: string; priceMonthly: number; priceYearly: number
    tagline: string; features: string[]; highlighted: boolean; cta: string
    limits: Record<string, number>
  }[]>([])
  const [loading, setLoading] = React.useState(true)
  const [upgrading, setUpgrading] = React.useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [u, p] = await Promise.allSettled([api.getMyUsage(), api.getPlans()])
      if (u.status === 'fulfilled') setUsage(u.value)
      if (p.status === 'fulfilled') setPlans(p.value.plans)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load billing data')
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { void load() }, [])

  async function handleUpgrade(planId: string) {
    setUpgrading(planId)
    const t = toast.loading(`Changing plan to ${planId}…`)
    try {
      await api.upgradePlan(planId)
      toast.dismiss(t)
      toast.success('Plan updated!')
      await load()
    } catch (err) {
      toast.dismiss(t)
      toast.error(err instanceof Error ? err.message : 'Failed to change plan')
    } finally {
      setUpgrading(null)
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16">
        <Card><CardContent className="p-12 text-center">Couldn&apos;t load billing data.</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
            <CreditCard className="h-5 w-5" />
          </span>
          Billing
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your subscription, track usage, and upgrade for higher limits.
        </p>
      </div>

      {/* Current plan */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-2xl">{usage.plan.name} Plan</CardTitle>
                {usage.plan.highlighted && (
                  <Badge className="gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    <Crown className="h-3 w-3" /> Popular
                  </Badge>
                )}
              </div>
              <CardDescription className="mt-1">{usage.plan.tagline}</CardDescription>
            </div>
            <div className="text-right">
              <p className="text-3xl font-semibold tracking-tight">
                ${usage.plan.priceMonthly}<span className="text-base font-normal text-muted-foreground">/mo</span>
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Usage meters */}
      <div className="mb-6">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Usage This Month</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {METRIC_ORDER.map((key) => {
            const meta = METRIC_META[key]
            const u = usage.usage[key]
            if (!u) return null
            const pct = u.unlimited ? 100 : u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0
            const isOver = !u.unlimited && u.used >= u.limit
            const isNear = !u.unlimited && u.used >= u.limit * 0.8 && u.used < u.limit
            return (
              <motion.div key={key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{meta.label}</p>
                      <span className={meta.accent}>{meta.icon}</span>
                    </div>
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {formatNumber(u.used)}
                      {u.unlimited ? (
                        <span className="ml-1 inline-flex items-center text-emerald-600 dark:text-emerald-300">
                          <InfinityIcon className="h-4 w-4" />
                        </span>
                      ) : (
                        <span className="text-sm font-normal text-muted-foreground"> / {formatNumber(u.limit)}</span>
                      )}
                    </p>
                    {!u.unlimited && (
                      <>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full transition-all', isOver ? 'bg-red-500' : isNear ? 'bg-amber-500' : 'bg-emerald-500')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className={cn('mt-1 text-[10px]', isOver ? 'text-red-600 dark:text-red-400' : isNear ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                          {isOver ? 'Limit reached' : `${formatNumber(u.limit - u.used)} remaining`}
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Plan comparison */}
      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">Plans</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const isCurrent = p.id === usage.plan.id
            const isUpgrading = upgrading === p.id
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('relative rounded-lg border-2 transition', p.highlighted ? 'border-emerald-400 dark:border-emerald-700' : 'border-border')}
              >
                {p.highlighted && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <Badge className="gap-1 bg-emerald-600 text-white"><Crown className="h-3 w-3" /> Popular</Badge>
                  </div>
                )}
                <div className="p-5">
                  <p className="text-sm font-semibold">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{p.tagline}</p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">${p.priceMonthly}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                  <ul className="mt-4 space-y-1.5 text-xs">
                    {p.features.map((f, i) => (
                      <li key={i} className="flex gap-1.5">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-500" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-5 w-full gap-1.5"
                    variant={p.highlighted ? 'default' : 'outline'}
                    disabled={isCurrent || isUpgrading !== null}
                    onClick={() => handleUpgrade(p.id)}
                  >
                    {isUpgrading ? <Loader2 className="h-4 w-4 animate-spin" /> : isCurrent ? <CheckCircle2 className="h-4 w-4" /> : null}
                    {isCurrent ? 'Current plan' : p.cta}
                  </Button>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
