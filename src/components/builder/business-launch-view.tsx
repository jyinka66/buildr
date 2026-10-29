'use client'

// BusinessLaunchView — the AI Co-Founder wizard.
// ------------------------------------------------------------------
// 3-step flow:
//   1. idea     — user describes their business idea
//   2. launching — animated progress while AI generates everything
//   3. result   — business plan + brand colors + pricing + action buttons
//                  + (NEW) Section A: Business Plan & Financials
//                  + (NEW) Section B: Investor Pitch Deck (10 slides)
//
// On launch, calls api.launchBusiness({ idea }) which:
//   - Generates a complete business plan (name, mission, vision, pricing)
//   - Creates a Buildr project with a multi-page website
//   - Generates legal documents (terms, privacy, cookies, refund)
//   - Generates a logo via image generation
//
// The result links to the project so the user can open it in the builder.
// After the result renders, two new sections appear below:
//   - BusinessPlanSection: calls api.generateBusinessPlan(businessId) and
//     shows Executive Summary / Market Analysis / Financial Projections /
//     SWOT / MVP Roadmap / Funding Strategy / Risks in a tabbed layout.
//   - PitchDeckSection: calls api.generatePitchDeck(businessId) and shows
//     a 10-slide investor deck with a sidebar navigator, prev/next controls,
//     and per-slide gradient backgrounds.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  BarChart3,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  DollarSign,
  FileSpreadsheet,
  FileText,
  Flame,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Loader2,
  Palette,
  Presentation,
  Rocket,
  Scale,
  ShieldAlert,
  Sparkles,
  Tag,
  Target,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EXAMPLES = [
  'A platform that connects freelance chefs with home cooks for private dining experiences',
  'An AI-powered fitness app that creates personalized workout plans based on your DNA',
  'A marketplace for renting outdoor gear from local outdoor enthusiasts',
  'A subscription service for monthly artisanal coffee from small-batch roasters',
]

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => asString(x)).filter(Boolean) : []
}

function asNumberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && !Number.isNaN(v) ? v : undefined
}

function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ''))
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

function asObject(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter(
        (x): x is Record<string, unknown> =>
          typeof x === 'object' && x !== null && !Array.isArray(x),
      )
    : []
}

function normalizeColor(c: string): string {
  if (!c) return '#059669'
  if (c.startsWith('#')) return c
  if (c.startsWith('rgb')) return c
  return `#${c}`
}

function fmtCurrency(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function BusinessLaunchView() {
  const [step, setStep] = React.useState<'idea' | 'launching' | 'result'>('idea')
  const [idea, setIdea] = React.useState('')
  const [launching, setLaunching] = React.useState(false)
  const [result, setResult] = React.useState<{
    business: Record<string, unknown>
    projectId: string
    fileCount: number
    logoPath: string | null
    message: string
  } | null>(null)
  const [history, setHistory] = React.useState<{
    id: string; name: string; slug: string; description: string
    status: string; projectId: string | null; createdAt: string
  }[]>([])

  const openBuilder = useBuilder((s) => s.openBuilder)

  React.useEffect(() => {
    void loadHistory()
  }, [])

  async function loadHistory() {
    try {
      const { businesses } = await api.listBusinesses()
      setHistory(businesses)
    } catch {
      /* non-fatal */
    }
  }

  async function handleLaunch() {
    if (idea.trim().length < 10) {
      toast.error('Please describe your idea in at least a sentence.')
      return
    }
    setLaunching(true)
    setStep('launching')
    try {
      const res = await api.launchBusiness({ idea: idea.trim() })
      setResult(res)
      setStep('result')
      void loadHistory()
      toast.success('Business launched!', {
        description: `${res.business.companyName || 'Your company'} is ready.`,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Launch failed. Please try again.')
      setStep('idea')
    } finally {
      setLaunching(false)
    }
  }

  function handleReset() {
    setStep('idea')
    setIdea('')
    setResult(null)
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight md:text-4xl"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
            <Rocket className="h-5 w-5" />
          </span>
          AI Co-Founder
        </motion.h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
          Describe your business idea. Buildr generates a complete company — website,
          brand kit, legal docs, and logo — in 60 seconds.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {/* ───────────── Step 1: Idea Input ───────────── */}
        {step === 'idea' && (
          <motion.div
            key="idea"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wand2 className="h-5 w-5 text-emerald-600" />
                  What do you want to build?
                </CardTitle>
                <CardDescription>
                  Describe your business idea in plain English. The more detail, the better the result.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  placeholder="e.g. A platform that connects freelance chefs with home cooks for private dining experiences…"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={5}
                  className="resize-none"
                  maxLength={1000}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{idea.length} / 1000 characters</span>
                  <span>{idea.trim().length >= 10 ? 'Ready to launch' : 'At least 10 characters'}</span>
                </div>

                {/* Example chips */}
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Or try an example:</p>
                  <div className="flex flex-col gap-1.5">
                    {EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        onClick={() => setIdea(ex)}
                        className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground transition hover:border-emerald-300 hover:bg-emerald-50/30 hover:text-foreground"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={handleLaunch}
                  disabled={launching || idea.trim().length < 10}
                  className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  size="lg"
                >
                  {launching ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Rocket className="h-5 w-5" />
                  )}
                  Launch my business
                </Button>
              </CardContent>
            </Card>

            {/* History */}
            {history.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-3 text-sm font-medium">Previously launched</h2>
                <div className="space-y-2">
                  {history.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => b.projectId && openBuilder(b.projectId)}
                      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-emerald-300"
                    >
                      <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                        <Briefcase className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{b.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{b.description}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-xs',
                          b.status === 'ready'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : b.status === 'generating'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-500/15 dark:text-zinc-300',
                        )}
                      >
                        {b.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ───────────── Step 2: Launching ───────────── */}
        {step === 'launching' && (
          <motion.div
            key="launching"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-20"
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white"
            >
              <Wand2 className="h-8 w-8" />
            </motion.div>
            <h2 className="mt-6 text-xl font-semibold">Launching your business…</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Generating business plan, website, brand kit, legal docs, and logo.
            </p>
            <div className="mt-6 space-y-2">
              {[
                { label: 'Business plan', icon: Sparkles },
                { label: 'Website (multi-page)', icon: Code2 },
                { label: 'Brand colors + fonts', icon: Palette },
                { label: 'Legal documents', icon: FileText },
                { label: 'Logo generation', icon: ImageIcon },
              ].map((s, i) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.3 }}
                  className="flex items-center gap-2 text-sm"
                >
                  <s.icon className="h-4 w-4 text-emerald-600" />
                  <span className="text-muted-foreground">{s.label}</span>
                  <motion.div
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3 }}
                  >
                    <Loader2 className="h-3.5 w-3.5 text-emerald-600" />
                  </motion.div>
                </motion.div>
              ))}
            </div>
            <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              This takes about 30-60 seconds
            </p>
          </motion.div>
        )}

        {/* ───────────── Step 3: Result ───────────── */}
        {step === 'result' && result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <BusinessResult
              result={result}
              onOpenBuilder={() => openBuilder(result.projectId)}
              onReset={handleReset}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BusinessResult — displays the generated business plan
// ---------------------------------------------------------------------------

function BusinessResult({
  result,
  onOpenBuilder,
  onReset,
}: {
  result: {
    business: Record<string, unknown>
    projectId: string
    fileCount: number
    logoPath: string | null
    message: string
  }
  onOpenBuilder: () => void
  onReset: () => void
}) {
  const b = result.business
  const businessId = asString(b.id)
  const companyName = asString(b.companyName, 'Your Company')
  const tagline = asString(b.tagline)
  const mission = asString(b.mission)
  const vision = asString(b.vision)
  const valueProp = asString(b.valueProposition)
  const targetAudience = asString(b.targetAudience)
  const features = asStringArray(b.features)
  const brandColors = (b.brandColors as Record<string, string>) || {}
  const brandFonts = (b.brandFonts as Record<string, string>) || {}
  const competitors = Array.isArray(b.competitors) ? b.competitors as Record<string, unknown>[] : []
  const businessModel = (b.businessModel as Record<string, unknown>) || {}
  const pricingPlans = Array.isArray(b.pricingPlans) ? b.pricingPlans as Record<string, unknown>[] : []

  return (
    <>
      {/* Success banner */}
      <Card className="border-emerald-300 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/10">
        <CardContent className="flex items-center gap-4 p-6">
          <CheckCircle2 className="h-10 w-10 flex-shrink-0 text-emerald-600" />
          <div>
            <h2 className="text-xl font-bold">{companyName} is ready! 🎉</h2>
            <p className="text-sm text-muted-foreground">{result.message}</p>
          </div>
        </CardContent>
      </Card>

      {/* Company name + tagline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{companyName}</CardTitle>
          {tagline && <CardDescription className="text-base">{tagline}</CardDescription>}
        </CardHeader>
      </Card>

      {/* Mission / Vision / Value Prop */}
      <div className="grid gap-4 md:grid-cols-3">
        {mission && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                Mission
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{mission}</p>
            </CardContent>
          </Card>
        )}
        {vision && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Rocket className="h-4 w-4 text-emerald-600" />
                Vision
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{vision}</p>
            </CardContent>
          </Card>
        )}
        {valueProp && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm">
                <Tag className="h-4 w-4 text-emerald-600" />
                Value Proposition
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{valueProp}</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Target Audience */}
      {targetAudience && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Target Audience</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{targetAudience}</p>
          </CardContent>
        </Card>
      )}

      {/* Brand Kit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Palette className="h-5 w-5 text-emerald-600" />
            Brand Kit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Colors</p>
            <div className="flex flex-wrap gap-3">
              {['primary', 'secondary', 'background', 'text'].map((key) => {
                const color = normalizeColor(asString(brandColors[key], '#059669'))
                return (
                  <div key={key} className="flex flex-col items-center gap-1">
                    <div
                      className="h-14 w-14 rounded-lg border border-border"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-[10px] capitalize text-muted-foreground">{key}</span>
                    <code className="text-[10px] text-muted-foreground">{color}</code>
                  </div>
                )
              })}
            </div>
          </div>
          {(brandFonts.heading || brandFonts.body) && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Fonts</p>
              <div className="flex gap-4 text-sm">
                {brandFonts.heading && (
                  <span>
                    <span className="text-muted-foreground">Heading: </span>
                    <span style={{ fontFamily: asString(brandFonts.heading) }}>{asString(brandFonts.heading)}</span>
                  </span>
                )}
                {brandFonts.body && (
                  <span>
                    <span className="text-muted-foreground">Body: </span>
                    <span style={{ fontFamily: asString(brandFonts.body) }}>{asString(brandFonts.body)}</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Features */}
      {features.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Key Features</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Pricing Plans */}
      {pricingPlans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pricing Plans</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              {pricingPlans.map((plan, i) => {
                const name = asString(plan.name, 'Plan')
                const price = asNumberOrUndefined(plan.price) ?? 0
                const period = asString(plan.period, '/mo')
                const planFeatures = asStringArray(plan.features)
                return (
                  <div
                    key={i}
                    className={cn(
                      'rounded-lg border p-4',
                      i === 1 ? 'border-emerald-400 bg-emerald-50/30 dark:border-emerald-700 dark:bg-emerald-950/10' : 'border-border',
                    )}
                  >
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="mt-1 text-2xl font-bold">
                      ${price}
                      <span className="text-sm font-normal text-muted-foreground">{period}</span>
                    </p>
                    <ul className="mt-3 space-y-1">
                      {planFeatures.map((f, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-xs">
                          <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Competitors */}
      {competitors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Competitors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {competitors.map((c, i) => {
                const cName = asString(c.name, 'Unknown')
                const cStrength = asString(c.strength)
                const cWeakness = asString(c.weakness)
                return (
                <div key={i} className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{cName}</p>
                  {cStrength && (
                    <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                      ✓ {cStrength}
                    </p>
                  )}
                  {cWeakness && (
                    <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">
                      ✗ {cWeakness}
                    </p>
                  )}
                </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onOpenBuilder} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" size="lg">
          <Code2 className="h-5 w-5" />
          Open Website in Builder
        </Button>
        <Button variant="outline" size="lg" onClick={onReset} className="gap-2">
          <Rocket className="h-5 w-5" />
          Launch another business
        </Button>
      </div>

      {/* ───────────── NEW: Section A — Business Plan & Financials ───────────── */}
      <div className="border-t border-border pt-6">
        <BusinessPlanSection businessId={businessId} />
      </div>

      {/* ───────────── NEW: Section B — Investor Pitch Deck ───────────── */}
      <PitchDeckSection businessId={businessId} />
    </>
  )
}

// ===========================================================================
// SECTION A — Business Plan & Financials
// ===========================================================================

function BusinessPlanSection({ businessId }: { businessId: string }) {
  const [plan, setPlan] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleGenerate() {
    if (!businessId) {
      toast.error('Missing business ID — try launching again.')
      return
    }
    setLoading(true)
    setError(null)
    const toastId = toast.loading('Generating full business plan with financial projections…')
    try {
      const res = await api.generateBusinessPlan(businessId)
      if (!res.ok) throw new Error('Plan generation failed.')
      setPlan(res.plan)
      toast.success('Business plan ready!', {
        id: toastId,
        description: 'Executive summary, financials, SWOT, funding strategy, and more.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate business plan.'
      setError(msg)
      toast.error('Plan generation failed', { id: toastId, description: msg })
    } finally {
      setLoading(false)
    }
  }

  // Initial state — show CTA button
  if (!plan && !loading && !error) {
    return (
      <Card className="border-emerald-200/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            Business Plan & Financials
          </CardTitle>
          <CardDescription>
            Generate a comprehensive business plan with 12-month financial projections,
            market analysis, SWOT, funding strategy, and risk assessment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleGenerate}
            disabled={!businessId}
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Generate Full Business Plan
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Loading state
  if (loading && !plan) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm font-medium">Generating business plan…</p>
          <p className="text-xs text-muted-foreground">
            Analyzing market, projecting financials, and building SWOT.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Error state — no plan loaded
  if (error && !plan) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
          <ShieldAlert className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Could not generate business plan</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">{error}</p>
          <Button onClick={handleGenerate} variant="outline" className="gap-2">
            <Wand2 className="h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Plan loaded — render the 7 sub-sections in Tabs
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      <Card className="border-emerald-200/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            Business Plan & Financials
          </CardTitle>
          <CardDescription>
            Comprehensive plan with market analysis, financial projections, SWOT,
            roadmap, funding, and risks.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="flex w-full flex-wrap h-auto">
          <TabsTrigger value="summary" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Summary
          </TabsTrigger>
          <TabsTrigger value="market" className="gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" /> Market
          </TabsTrigger>
          <TabsTrigger value="financials" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" /> Financials
          </TabsTrigger>
          <TabsTrigger value="swot" className="gap-1.5">
            <Scale className="h-3.5 w-3.5" /> SWOT
          </TabsTrigger>
          <TabsTrigger value="roadmap" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Roadmap
          </TabsTrigger>
          <TabsTrigger value="funding" className="gap-1.5">
            <DollarSign className="h-3.5 w-3.5" /> Funding
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5" /> Risks
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="mt-4">
          <ExecutiveSummaryCard summary={asString(plan!.executiveSummary)} />
        </TabsContent>
        <TabsContent value="market" className="mt-4">
          <MarketAnalysisCard market={asObject(plan!.marketAnalysis)} />
        </TabsContent>
        <TabsContent value="financials" className="mt-4">
          <FinancialProjectionsCard financials={asObject(plan!.financialProjections)} />
        </TabsContent>
        <TabsContent value="swot" className="mt-4">
          <SwotCard swot={asObject(plan!.swot)} />
        </TabsContent>
        <TabsContent value="roadmap" className="mt-4">
          <MvpRoadmapCard roadmap={asObjectArray(plan!.mvpRoadmap)} />
        </TabsContent>
        <TabsContent value="funding" className="mt-4">
          <FundingStrategyCard funding={asObject(plan!.fundingStrategy)} />
        </TabsContent>
        <TabsContent value="risks" className="mt-4">
          <RisksCard risks={asObjectArray(plan!.risks)} />
        </TabsContent>
      </Tabs>

      <div className="flex justify-end">
        <Button
          onClick={handleGenerate}
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
          Regenerate plan
        </Button>
      </div>
    </motion.div>
  )
}

// ----- A1. Executive Summary -----

function ExecutiveSummaryCard({ summary }: { summary: string }) {
  const [headline, setHeadline] = React.useState('')
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          Executive Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary ? (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{summary}</p>
        ) : (
          <p className="text-sm italic text-muted-foreground">No executive summary available.</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="headline-insight" className="text-xs text-muted-foreground">
            Your headline insight
          </Label>
          <Input
            id="headline-insight"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="The one sentence that captures this opportunity…"
            className="text-sm"
            maxLength={140}
          />
          <p className="text-[10px] text-muted-foreground">
            {headline.length}/140 — visible only to you.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ----- A2. Market Analysis (TAM/SAM/SOM + trends) -----

function MarketAnalysisCard({ market }: { market: Record<string, unknown> }) {
  const tam = asString(market.tam)
  const sam = asString(market.sam)
  const som = asString(market.som)
  const trends = asStringArray(market.marketTrends)
  const growthRate = asString(market.marketGrowthRate)

  const stats = [
    { label: 'TAM', desc: 'Total Addressable Market', value: tam },
    { label: 'SAM', desc: 'Serviceable Addressable Market', value: sam },
    { label: 'SOM', desc: 'Serviceable Obtainable Market', value: som },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-emerald-600" />
          Market Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-emerald-200/60 bg-gradient-to-br from-emerald-50/60 to-teal-50/40 p-4 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:to-teal-950/10"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                {s.label}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.desc}</p>
              <p className="mt-2 text-lg font-bold leading-tight">{s.value || '—'}</p>
            </div>
          ))}
        </div>

        {growthRate && (
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <span className="text-muted-foreground">Estimated annual growth:</span>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {growthRate}
            </Badge>
          </div>
        )}

        {trends.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Market trends</p>
            <ul className="space-y-1.5">
              {trends.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ----- A3. Financial Projections (12-month table + Y3/Y5 cards + burn/break-even) -----

function FinancialProjectionsCard({ financials }: { financials: Record<string, unknown> }) {
  const year1 = asObject(financials.year1)
  const year3 = asObject(financials.year3)
  const year5 = asObject(financials.year5)
  const monthly = asObjectArray(year1.monthly)
  const burnRate = asNumberOrUndefined(year1.burnRate)
  const breakEven = asString(year1.breakEvenMonth, '—')
  const y1Revenue = asNumberOrUndefined(year1.totalRevenue) ?? 0
  const y1Costs = asNumberOrUndefined(year1.totalCosts) ?? 0
  const y1Net = asNumberOrUndefined(year1.netProfit) ?? 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          Financial Projections
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Year 1 monthly breakdown */}
        {monthly.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">Year 1 — monthly breakdown</p>
              <Badge variant="outline" className="text-xs">{monthly.length} months</Badge>
            </div>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="pl-3">Month</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Costs</TableHead>
                    <TableHead className="pr-3 text-right">Net Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthly.map((m, i) => {
                    const month = asString(m.month, `Month ${i + 1}`)
                    const rev = asNumber(m.revenue)
                    const costs = asNumber(m.costs)
                    const net = asNumber(m.netProfit)
                    return (
                      <TableRow key={i}>
                        <TableCell className="pl-3 font-medium">{month}</TableCell>
                        <TableCell className="text-right tabular-nums">{fmtCurrency(rev)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                          {fmtCurrency(costs)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'pr-3 text-right font-medium tabular-nums',
                            net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                          )}
                        >
                          {fmtCurrency(net)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {/* Year 3 / Year 5 summary cards */}
        <div className="grid gap-3 sm:grid-cols-2">
          <YearSummaryCard title="Year 3 Projection" data={year3} accent="blue" />
          <YearSummaryCard title="Year 5 Projection" data={year5} accent="violet" />
        </div>

        {/* Burn rate + break-even badges */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="text-muted-foreground">Burn rate:</span>
            <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
              {burnRate !== undefined ? `${fmtCurrency(burnRate)}/mo` : '—'}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Target className="h-4 w-4 text-emerald-600" />
            <span className="text-muted-foreground">Break-even month:</span>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {breakEven}
            </Badge>
          </div>
        </div>

        {/* Year 1 totals quick row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-border p-2">
            <p className="text-[10px] uppercase text-muted-foreground">Y1 Revenue</p>
            <p className="text-sm font-semibold">{fmtCurrency(y1Revenue)}</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="text-[10px] uppercase text-muted-foreground">Y1 Costs</p>
            <p className="text-sm font-semibold">{fmtCurrency(y1Costs)}</p>
          </div>
          <div className="rounded-md border border-border p-2">
            <p className="text-[10px] uppercase text-muted-foreground">Y1 Net</p>
            <p
              className={cn(
                'text-sm font-semibold',
                y1Net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
              )}
            >
              {fmtCurrency(y1Net)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function YearSummaryCard({
  title,
  data,
  accent,
}: {
  title: string
  data: Record<string, unknown>
  accent: 'blue' | 'violet'
}) {
  const rev = asNumberOrUndefined(data.totalRevenue) ?? 0
  const costs = asNumberOrUndefined(data.totalCosts) ?? 0
  const net = asNumberOrUndefined(data.netProfit) ?? 0
  const accentClasses =
    accent === 'blue'
      ? 'border-blue-200/60 from-blue-50/60 to-indigo-50/40 dark:border-blue-900/40 dark:from-blue-950/20 dark:to-indigo-950/10'
      : 'border-violet-200/60 from-violet-50/60 to-purple-50/40 dark:border-violet-900/40 dark:from-violet-950/20 dark:to-purple-950/10'
  return (
    <div className={cn('rounded-lg border bg-gradient-to-br p-4', accentClasses)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="mt-2 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Revenue</span>
          <span className="font-medium tabular-nums">{fmtCurrency(rev)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Costs</span>
          <span className="font-medium tabular-nums">{fmtCurrency(costs)}</span>
        </div>
        <div className="flex justify-between border-t border-border/60 pt-1.5">
          <span className="text-muted-foreground">Net profit</span>
          <span
            className={cn(
              'font-bold tabular-nums',
              net >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
            )}
          >
            {fmtCurrency(net)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ----- A4. SWOT (4-quadrant grid + action items) -----

function SwotCard({ swot }: { swot: Record<string, unknown> }) {
  const strengths = asStringArray(swot.strengths)
  const weaknesses = asStringArray(swot.weaknesses)
  const opportunities = asStringArray(swot.opportunities)
  const threats = asStringArray(swot.threats)
  const actions = asStringArray(swot.actionItems)

  const quadrants = [
    {
      title: 'Strengths',
      items: strengths,
      icon: ThumbsUp,
      border: 'border-emerald-400/60',
      bg: 'bg-emerald-50/40 dark:bg-emerald-950/15',
      iconColor: 'text-emerald-600',
      dot: 'bg-emerald-500',
    },
    {
      title: 'Weaknesses',
      items: weaknesses,
      icon: ThumbsDown,
      border: 'border-amber-400/60',
      bg: 'bg-amber-50/40 dark:bg-amber-950/15',
      iconColor: 'text-amber-600',
      dot: 'bg-amber-500',
    },
    {
      title: 'Opportunities',
      items: opportunities,
      icon: Lightbulb,
      border: 'border-blue-400/60',
      bg: 'bg-blue-50/40 dark:bg-blue-950/15',
      iconColor: 'text-blue-600',
      dot: 'bg-blue-500',
    },
    {
      title: 'Threats',
      items: threats,
      icon: ShieldAlert,
      border: 'border-red-400/60',
      bg: 'bg-red-50/40 dark:bg-red-950/15',
      iconColor: 'text-red-600',
      dot: 'bg-red-500',
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-emerald-600" />
          SWOT Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {quadrants.map((q) => (
            <div key={q.title} className={cn('rounded-lg border-2 p-4', q.border, q.bg)}>
              <div className="mb-2 flex items-center gap-2">
                <q.icon className={cn('h-4 w-4', q.iconColor)} />
                <h4 className="text-sm font-semibold">{q.title}</h4>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {q.items.length}
                </Badge>
              </div>
              {q.items.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">No items.</p>
              ) : (
                <ul className="space-y-1.5">
                  {q.items.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className={cn('mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full', q.dot)} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {actions.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Action items</p>
            <ul className="space-y-1.5">
              {actions.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ----- A5. MVP Roadmap (timeline with phases) -----

function MvpRoadmapCard({ roadmap }: { roadmap: Record<string, unknown>[] }) {
  if (roadmap.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-emerald-600" />
            MVP Roadmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm italic text-muted-foreground">No roadmap available.</p>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4 text-emerald-600" />
          MVP Roadmap
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative space-y-4 border-l border-emerald-200 pl-6 dark:border-emerald-900/50">
          {roadmap.map((phase, i) => {
            const name = asString(phase.phase, `Phase ${i + 1}`)
            const timeline = asString(phase.timeline)
            const goal = asString(phase.goal)
            const features = asStringArray(phase.features)
            return (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.08 }}
                className="relative"
              >
                <span className="absolute -left-[26px] top-1 grid h-4 w-4 place-items-center rounded-full bg-emerald-500 ring-4 ring-background">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                </span>
                <div className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                      Phase {i + 1}
                    </Badge>
                    <h4 className="text-sm font-semibold">{name}</h4>
                    {timeline && (
                      <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {timeline}
                      </span>
                    )}
                  </div>
                  {goal && <p className="mt-1.5 text-xs text-muted-foreground">{goal}</p>}
                  {features.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {features.map((f, j) => (
                        <li key={j} className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px]">
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

// ----- A6. Funding Strategy (recommendation + use-of-funds bar list + milestones + valuation) -----

function FundingStrategyCard({ funding }: { funding: Record<string, unknown> }) {
  const recommendation = asString(funding.recommendation)
  const amountToRaise = asString(funding.amountToRaise)
  const valuation = asString(funding.valuationEstimate)
  const useOfFunds = asObjectArray(funding.useOfFunds)
  const milestones = asStringArray(funding.milestones)

  // Scale bars relative to the largest percentage for visual contrast.
  const maxPct = useOfFunds.reduce((m, u) => Math.max(m, asNumber(u.percentage)), 0) || 100

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4 text-emerald-600" />
          Funding Strategy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {recommendation && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Recommendation</p>
              <div className="mt-1">
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  {recommendation}
                </Badge>
              </div>
            </div>
          )}
          {amountToRaise && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-[10px] uppercase text-muted-foreground">Amount to raise</p>
              <p className="mt-1 text-xl font-bold">{amountToRaise}</p>
            </div>
          )}
        </div>

        {useOfFunds.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Use of funds</p>
            <div className="space-y-2">
              {useOfFunds.map((u, i) => {
                const category = asString(u.category, 'Other')
                const amount = asString(u.amount)
                const pct = Math.max(0, Math.min(100, asNumber(u.percentage)))
                const widthPct = maxPct > 0 ? (pct / maxPct) * 100 : pct
                return (
                  <div key={i}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{category}</span>
                      <span className="text-muted-foreground">
                        {amount} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.05 }}
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {milestones.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Milestones</p>
            <ul className="space-y-1.5">
              {milestones.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Target className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {valuation && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50/40 p-3 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/15">
            <TrendingUp className="h-4 w-4 text-emerald-600" />
            <span className="text-muted-foreground">Estimated valuation:</span>
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              {valuation}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ----- A7. Risks (table with risk/impact/mitigation) -----

function RisksCard({ risks }: { risks: Record<string, unknown>[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-emerald-600" />
          Risks & Mitigations
        </CardTitle>
      </CardHeader>
      <CardContent>
        {risks.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">No risks identified.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="pl-3">Risk</TableHead>
                  <TableHead>Impact</TableHead>
                  <TableHead className="pr-3">Mitigation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {risks.map((r, i) => {
                  const risk = asString(r.risk, `Risk ${i + 1}`)
                  const impact = asString(r.impact, '—')
                  const mitigation = asString(r.mitigation, '—')
                  const impactLower = impact.toLowerCase()
                  const impactBadge = impactLower.includes('high')
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                    : impactLower.includes('low')
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  return (
                    <TableRow key={i}>
                      <TableCell className="pl-3 align-top font-medium">{risk}</TableCell>
                      <TableCell className="align-top">
                        <Badge variant="outline" className={cn('text-xs', impactBadge)}>
                          {impact}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-3 align-top text-muted-foreground">{mitigation}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ===========================================================================
// SECTION B — Investor Pitch Deck (10 slides)
// ===========================================================================

// Each slide gets a distinct gradient background. Index 0 → slide 1, etc.
const SLIDE_GRADIENTS = [
  'from-blue-500 via-indigo-500 to-violet-600',
  'from-emerald-500 via-teal-500 to-cyan-600',
  'from-purple-500 via-fuchsia-500 to-pink-600',
  'from-amber-500 via-orange-500 to-red-500',
  'from-cyan-500 via-sky-500 to-blue-600',
  'from-rose-500 via-pink-500 to-fuchsia-600',
  'from-lime-500 via-green-500 to-emerald-600',
  'from-violet-500 via-purple-500 to-indigo-600',
  'from-yellow-500 via-amber-500 to-orange-600',
  'from-slate-600 via-gray-700 to-zinc-800',
]

interface PitchSlide {
  number: number
  title: string
  bullets: string[]
  talkingPoints: string
}

function parseSlides(deck: Record<string, unknown>): PitchSlide[] {
  const rawSlides = Array.isArray(deck.slides) ? deck.slides : []
  return rawSlides
    .filter(
      (s): s is Record<string, unknown> =>
        typeof s === 'object' && s !== null && !Array.isArray(s),
    )
    .map((s, i) => ({
      number: asNumber(s.number, i + 1),
      title: asString(s.title, `Slide ${i + 1}`),
      bullets: asStringArray(s.bullets),
      talkingPoints: asString(s.talkingPoints),
    }))
    .sort((a, b) => a.number - b.number)
}

function PitchDeckSection({ businessId }: { businessId: string }) {
  const [deck, setDeck] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [current, setCurrent] = React.useState(0)

  const slides = React.useMemo(() => (deck ? parseSlides(deck) : []), [deck])
  const summary = asString(deck?.summary)

  async function handleGenerate() {
    if (!businessId) {
      toast.error('Missing business ID — try launching again.')
      return
    }
    setLoading(true)
    setError(null)
    setCurrent(0)
    const toastId = toast.loading('Generating investor pitch deck…')
    try {
      const res = await api.generatePitchDeck(businessId)
      if (!res.ok) throw new Error('Pitch deck generation failed.')
      setDeck(res.deck)
      toast.success('Pitch deck ready!', {
        id: toastId,
        description: '10 slides ready to present.',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate pitch deck.'
      setError(msg)
      toast.error('Pitch deck generation failed', { id: toastId, description: msg })
    } finally {
      setLoading(false)
    }
  }

  // Initial CTA
  if (!deck && !loading && !error) {
    return (
      <Card className="border-indigo-200/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Presentation className="h-5 w-5 text-indigo-600" />
            Investor Pitch Deck
          </CardTitle>
          <CardDescription>
            Generate a 10-slide investor pitch deck with talking points you can present in minutes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleGenerate}
            disabled={!businessId}
            className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Presentation className="h-4 w-4" />
            Generate Pitch Deck
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Loading state
  if (loading && !deck) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <p className="text-sm font-medium">Generating pitch deck…</p>
          <p className="text-xs text-muted-foreground">Crafting 10 slides with talking points.</p>
        </CardContent>
      </Card>
    )
  }

  // Error state — no deck loaded
  if (error && !deck) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
          <ShieldAlert className="h-8 w-8 text-destructive" />
          <p className="text-sm font-medium">Could not generate pitch deck</p>
          <p className="max-w-md text-center text-xs text-muted-foreground">{error}</p>
          <Button onClick={handleGenerate} variant="outline" className="gap-2">
            <Wand2 className="h-4 w-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Empty slides fallback
  if (slides.length === 0) {
    return (
      <Card className="border-amber-300/60">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
          <ShieldAlert className="h-8 w-8 text-amber-500" />
          <p className="text-sm font-medium">Pitch deck returned no slides</p>
          <Button onClick={handleGenerate} variant="outline" className="gap-2">
            <Wand2 className="h-4 w-4" />
            Regenerate
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Deck loaded — render navigator + main display + controls
  const safeCurrent = Math.min(current, slides.length - 1)
  const slide = slides[safeCurrent]
  const gradient = SLIDE_GRADIENTS[(slide.number - 1) % SLIDE_GRADIENTS.length]

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4"
    >
      <Card className="border-indigo-200/60">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Presentation className="h-5 w-5 text-indigo-600" />
            <CardTitle className="text-lg">Investor Pitch Deck</CardTitle>
            <Badge variant="outline" className="ml-auto text-xs">
              {slides.length} slides
            </Badge>
          </div>
          {summary && <CardDescription className="mt-1">{summary}</CardDescription>}
        </CardHeader>
      </Card>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        {/* Slide navigator sidebar (1–N) */}
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <p className="text-xs font-medium text-muted-foreground">Slides</p>
          </CardHeader>
          <CardContent className="p-2">
            <ol className="space-y-1">
              {slides.map((s, i) => {
                const isActive = i === safeCurrent
                const grad = SLIDE_GRADIENTS[(s.number - 1) % SLIDE_GRADIENTS.length]
                return (
                  <li key={i}>
                    <button
                      onClick={() => setCurrent(i)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition',
                        isActive ? 'bg-muted font-medium' : 'hover:bg-muted/60',
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-5 w-5 flex-shrink-0 place-items-center rounded bg-gradient-to-br text-[10px] font-bold text-white',
                          grad,
                        )}
                      >
                        {s.number}
                      </span>
                      <span className="truncate">{s.title}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </CardContent>
        </Card>

        {/* Main slide display + controls */}
        <div className="space-y-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.number}
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: -8 }}
              transition={{ duration: 0.25 }}
              className={cn(
                'relative aspect-video overflow-hidden rounded-xl bg-gradient-to-br p-6 text-white shadow-lg',
                gradient,
              )}
            >
              <div className="absolute right-4 top-3 text-xs font-medium opacity-70">
                Slide {slide.number} / {slides.length}
              </div>
              <div className="text-xs font-semibold uppercase tracking-widest opacity-80">
                Slide {slide.number}
              </div>
              <h3 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{slide.title}</h3>
              {slide.bullets.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {slide.bullets.map((b, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.06 }}
                      className="flex items-start gap-2 text-sm md:text-base"
                    >
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/90" />
                      <span>{b}</span>
                    </motion.li>
                  ))}
                </ul>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Talking points (muted box) */}
          {slide.talkingPoints && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Lightbulb className="h-3.5 w-3.5" />
                Talking points
              </p>
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {slide.talkingPoints}
              </p>
            </div>
          )}

          {/* Navigation: Previous / progress / Next */}
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={safeCurrent === 0}
              className="gap-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>

            <div className="flex items-center gap-2">
              {/* Progress dots */}
              <div className="hidden items-center gap-1 sm:flex">
                {slides.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setCurrent(i)}
                    aria-label={`Go to slide ${s.number}`}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === safeCurrent
                        ? 'w-6 bg-indigo-600'
                        : 'w-1.5 bg-muted hover:bg-muted-foreground/60',
                    )}
                  />
                ))}
              </div>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                Slide {safeCurrent + 1} of {slides.length}
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrent((c) => Math.min(slides.length - 1, c + 1))}
              disabled={safeCurrent === slides.length - 1}
              className="gap-1.5"
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleGenerate}
              variant="ghost"
              size="sm"
              className="gap-2 text-muted-foreground"
              disabled={loading}
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Regenerate deck
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
