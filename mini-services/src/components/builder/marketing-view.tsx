'use client'

// MarketingView — AI Marketing & Sales generator.
// ------------------------------------------------------------------
// Layout:
//   1. Header + description of what the view does.
//   2. Tabs: Ads | Social | Email | SEO | Ad Creatives | Email Flows.
//      - The first four share a generic generator (POST /api/marketing/generate)
//        driven by the TABS config + the TabGenerator component.
//      - "Ad Creatives" uses api.generateAdCreatives() and renders an image,
//        A/B test variants, targeting suggestions, and the image prompt.
//      - "Email Flows" uses api.generateEmailFlow() and renders a full
//        automation sequence with branching logic and optimization tips.
//   3. Each tab has:
//      - A brief Textarea (the prompt context).
//      - A platform/type selector relevant to that tab.
//      - A "Generate" button.
//      - A result card rendering the JSON shape returned by that type.
//
// Uses framer-motion for transitions. Toasts via sonner.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowDown,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Download,
  GitBranch,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  Mic2,
  MousePointerClick,
  Search,
  Share2,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wand2,
  Workflow,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { api } from '@/lib/api-client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import { SocialScheduler } from '@/components/builder/social-scheduler'
import RoiDashboard from '@/components/builder/roi-dashboard'
import { BrandVoiceTrainer } from '@/components/builder/brand-voice-trainer'

// ---------------------------------------------------------------------------
// Local API client (kept for the original 4 tabs; new tabs use `api`).
// ---------------------------------------------------------------------------

interface MarketingResult {
  ok: boolean
  parseError: string | null
  campaign: {
    id: string
    type: CampaignType
    platform: string
    content: Record<string, unknown>
    status: string
    createdAt: string
  }
}

async function postGenerate(
  body: GenerateBody,
  signal?: AbortSignal,
): Promise<MarketingResult> {
  const res = await fetch('/api/marketing/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let msg = `request_failed (${res.status})`
    try {
      const data = await res.json()
      if (data?.error) msg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<MarketingResult>
}

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type CampaignType = 'ads' | 'social' | 'email' | 'seo'
type TabValue = CampaignType | 'ad-creatives' | 'email-flows' | 'scheduler' | 'roi' | 'voice'
type Platform = string

interface GenerateBody {
  type: CampaignType
  platform?: Platform
  businessId?: string
  projectId?: string
  description?: string
}

interface TabDef {
  value: CampaignType
  label: string
  icon: React.ReactNode
  accent: string
  gradient: string
  description: string
  platforms: { value: string; label: string }[]
  placeholder: string
  examples: string[]
}

const TABS: TabDef[] = [
  {
    value: 'ads',
    label: 'Ads',
    icon: <Target className="h-4 w-4" />,
    accent: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
    gradient: 'from-blue-500 to-indigo-600',
    description: 'Generate ad copy for paid acquisition channels.',
    platforms: [
      { value: 'google', label: 'Google' },
      { value: 'meta', label: 'Meta' },
      { value: 'tiktok', label: 'TikTok' },
      { value: 'twitter', label: 'X / Twitter' },
    ],
    placeholder: 'e.g. We sell a $29/mo AI-powered meal planner for busy parents.',
    examples: [
      'Promote our Black Friday sale with 40% off annual plans.',
      'Launch campaign for a new AI logo maker targeting startups.',
    ],
  },
  {
    value: 'social',
    label: 'Social',
    icon: <Share2 className="h-4 w-4" />,
    accent: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
    gradient: 'from-pink-500 to-rose-600',
    description: 'Generate social media posts with captions and hashtags.',
    platforms: [
      { value: 'all', label: 'All' },
      { value: 'linkedin', label: 'LinkedIn' },
      { value: 'twitter', label: 'X / Twitter' },
      { value: 'instagram', label: 'Instagram' },
      { value: 'tiktok', label: 'TikTok' },
    ],
    placeholder: 'e.g. We are announcing a $5M seed round for our developer tools startup.',
    examples: [
      'Announce a new product feature with a behind-the-scenes story.',
      'Recap of our latest webinar on no-code automation.',
    ],
  },
  {
    value: 'email',
    label: 'Email',
    icon: <Mail className="h-4 w-4" />,
    accent: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    gradient: 'from-amber-500 to-orange-600',
    description: 'Generate a complete email campaign with A/B subject lines.',
    platforms: [
      { value: 'all', label: 'All' },
      { value: 'newsletter', label: 'Newsletter' },
      { value: 'drip', label: 'Drip' },
      { value: 'promo', label: 'Promo' },
      { value: 'winback', label: 'Win-back' },
    ],
    placeholder: 'e.g. Welcome email for new trial users of our SaaS analytics tool.',
    examples: [
      'Win-back email for users who cancelled in the last 30 days.',
      'Launch announcement for our new pricing tiers.',
    ],
  },
  {
    value: 'seo',
    label: 'SEO',
    icon: <Search className="h-4 w-4" />,
    accent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    gradient: 'from-emerald-500 to-teal-600',
    description: 'Generate an SEO content package with outline + keywords.',
    platforms: [
      { value: 'all', label: 'General' },
      { value: 'blog', label: 'Blog' },
      { value: 'landing', label: 'Landing' },
      { value: 'product', label: 'Product' },
    ],
    placeholder: 'e.g. Target keyword: "best no-code website builder for freelancers".',
    examples: [
      'SEO package for a comparison page: "Stripe vs PayPal for SaaS".',
      'Pillar page for "AI prompt engineering" with cluster topics.',
    ],
  },
]

// Ad creative platforms (Tab 5).
const AD_PLATFORMS: {
  value: string
  label: string
  sub: string
  icon: React.ReactNode
}[] = [
  { value: 'meta', label: 'Meta', sub: 'Facebook / Instagram', icon: <Share2 className="h-4 w-4" /> },
  { value: 'google', label: 'Google', sub: 'Search & Display', icon: <Search className="h-4 w-4" /> },
  { value: 'tiktok', label: 'TikTok', sub: 'Short-form video', icon: <Sparkles className="h-4 w-4" /> },
]

// Email flow types (Tab 6).
const EMAIL_FLOW_TYPES: {
  value: 'welcome' | 'abandoned_cart' | 'reengagement'
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'welcome',
    label: 'Welcome Flow',
    description: 'Onboard new subscribers with a warm, high-converting introduction series.',
    icon: <Mail className="h-5 w-5" />,
  },
  {
    value: 'abandoned_cart',
    label: 'Abandoned Cart',
    description: 'Recover lost revenue from shoppers who left without completing checkout.',
    icon: <Target className="h-5 w-5" />,
  },
  {
    value: 'reengagement',
    label: 'Re-engagement',
    description: 'Win back inactive users before they churn for good.',
    icon: <Sparkles className="h-5 w-5" />,
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => asString(x)).filter(Boolean) : []
}
function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}
function asObjectArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return []
  return v.filter(
    (x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x),
  )
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied to clipboard.`)
  } catch {
    toast.error('Could not copy to clipboard.')
  }
}

/** Highlights {{personalization_tokens}} inside an email body. */
function renderTokens(text: string): React.ReactNode {
  const parts = text.split(/(\{\{[^}]+\}\})/g)
  return parts.map((part, i) => {
    if (/^\{\{[^}]+\}\}$/.test(part)) {
      return (
        <span
          key={i}
          className="mx-0.5 rounded bg-amber-100 px-1 font-mono text-[11px] text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
        >
          {part}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

// ---------------------------------------------------------------------------
// Per-type result renderers (original 4 tabs)
// ---------------------------------------------------------------------------

function AdsResult({ content }: { content: Record<string, unknown> }) {
  const headlines = asStringArray(content.headlineVariants)
  const descriptions = asStringArray(content.descriptions)
  const tips = asStringArray(content.targetingTips)
  const cta = asString(content.cta)
  const budget = asString(content.budgetHint)
  const platform = asString(content.platform, 'platform')
  return (
    <div className="space-y-4">
      <SectionLabel icon={<Target className="h-3.5 w-3.5" />} label={`Headlines — ${platform}`}>
        <div className="space-y-2">
          {headlines.map((h, i) => (
            <CopyRow key={i} text={h} label={`Headline ${i + 1}`} className="text-sm font-medium" />
          ))}
        </div>
      </SectionLabel>

      {descriptions.length > 0 && (
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} label="Descriptions">
          <div className="space-y-2">
            {descriptions.map((d, i) => (
              <CopyRow key={i} text={d} label={`Description ${i + 1}`} className="text-sm text-muted-foreground" />
            ))}
          </div>
        </SectionLabel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {cta && (
          <KVCard label="Call to action" value={cta} />
        )}
        {budget && (
          <KVCard label="Budget hint" value={budget} />
        )}
      </div>

      {tips.length > 0 && (
        <SectionLabel icon={<Target className="h-3.5 w-3.5" />} label="Targeting tips">
          <ul className="space-y-1.5 text-sm">
            {tips.map((t, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </SectionLabel>
      )}
    </div>
  )
}

function SocialResult({ content }: { content: Record<string, unknown> }) {
  const caption = asString(content.caption)
  const variants = asStringArray(content.captionVariants)
  const hashtags = asStringArray(content.hashtags)
  const imagePrompt = asString(content.imagePrompt)
  const bestTime = asString(content.bestTimeToPost)
  const platform = asString(content.platform, 'social')

  return (
    <div className="space-y-4">
      {caption && (
        <SectionLabel icon={<Share2 className="h-3.5 w-3.5" />} label={`Caption — ${platform}`}>
          <CopyBlock text={caption} label="Caption" />
        </SectionLabel>
      )}

      {variants.length > 0 && (
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} label="Alternate captions">
          <div className="space-y-2">
            {variants.map((v, i) => (
              <CopyRow key={i} text={v} label={`Variant ${i + 1}`} className="text-sm text-muted-foreground" />
            ))}
          </div>
        </SectionLabel>
      )}

      {hashtags.length > 0 && (
        <SectionLabel icon={<Hash className="h-3.5 w-3.5" />} label="Hashtags">
          <div className="flex flex-wrap gap-1.5">
            {hashtags.map((h, i) => (
              <button
                key={i}
                onClick={() => void copyToClipboard(`#${h}`, `#${h}`)}
                className="rounded-md bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-700 transition hover:bg-pink-200 dark:bg-pink-500/15 dark:text-pink-300"
              >
                #{h}
              </button>
            ))}
          </div>
        </SectionLabel>
      )}

      {imagePrompt && (
        <SectionLabel icon={<ImageIcon className="h-3.5 w-3.5" />} label="Image prompt">
          <CopyBlock text={imagePrompt} label="Image prompt" />
        </SectionLabel>
      )}

      {bestTime && (
        <KVCard label="Best time to post" value={bestTime} />
      )}
    </div>
  )
}

function EmailResult({ content }: { content: Record<string, unknown> }) {
  const subject = asString(content.subject)
  const variants = asStringArray(content.subjectVariants)
  const preview = asString(content.previewText)
  const greeting = asString(content.greeting)
  const body = asString(content.body)
  const cta = asString(content.cta)
  const ps = asString(content.postscript)
  const sendTip = asString(content.sendTip)

  return (
    <div className="space-y-4">
      {subject && (
        <SectionLabel icon={<Mail className="h-3.5 w-3.5" />} label="Subject line">
          <CopyRow text={subject} label="Subject" className="text-sm font-semibold" />
        </SectionLabel>
      )}

      {variants.length > 0 && (
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} label="A/B subject variants">
          <div className="space-y-2">
            {variants.map((v, i) => (
              <CopyRow key={i} text={v} label={`Variant ${i + 1}`} className="text-sm text-muted-foreground" />
            ))}
          </div>
        </SectionLabel>
      )}

      {preview && (
        <KVCard label="Preview text" value={preview} />
      )}

      {body && (
        <SectionLabel icon={<Mail className="h-3.5 w-3.5" />} label="Body">
          <div className="space-y-3">
            {greeting && <p className="text-sm font-medium">{greeting}</p>}
            <CopyBlock text={body} label="Body" multiline />
          </div>
        </SectionLabel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {cta && <KVCard label="CTA button" value={cta} />}
        {sendTip && <KVCard label="Send tip" value={sendTip} />}
      </div>

      {ps && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">P.S.</span> {ps}
        </p>
      )}
    </div>
  )
}

function SeoResult({ content }: { content: Record<string, unknown> }) {
  const title = asString(content.title)
  const meta = asString(content.metaDescription)
  const primary = asString(content.primaryKeyword)
  const secondary = asStringArray(content.secondaryKeywords)
  const slug = asString(content.urlSlug)
  const outline = asObjectArray(content.blogOutline)
  const internalLinks = asStringArray(content.internalLinkTargets)

  return (
    <div className="space-y-4">
      {title && (
        <SectionLabel icon={<Search className="h-3.5 w-3.5" />} label="Title">
          <CopyRow text={title} label="Title" className="text-sm font-semibold" />
        </SectionLabel>
      )}

      {meta && (
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} label="Meta description">
          <CopyRow text={meta} label="Meta description" className="text-sm text-muted-foreground" />
        </SectionLabel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {primary && <KVCard label="Primary keyword" value={primary} />}
        {slug && <KVCard label="URL slug" value={slug} mono />}
      </div>

      {secondary.length > 0 && (
        <SectionLabel icon={<Hash className="h-3.5 w-3.5" />} label="Secondary keywords">
          <div className="flex flex-wrap gap-1.5">
            {secondary.map((k, i) => (
              <span key={i} className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                {k}
              </span>
            ))}
          </div>
        </SectionLabel>
      )}

      {outline.length > 0 && (
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} label="Blog outline">
          <ol className="space-y-3">
            {outline.map((s, i) => {
              const heading = asString(s.heading)
              const points = asStringArray(s.points)
              return (
                <li key={i} className="rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-sm font-medium">H2 · {heading}</p>
                  {points.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {points.map((p, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-600" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </SectionLabel>
      )}

      {internalLinks.length > 0 && (
        <SectionLabel icon={<Sparkles className="h-3.5 w-3.5" />} label="Internal link targets">
          <ul className="space-y-1 text-sm">
            {internalLinks.map((l, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                <span>{l}</span>
              </li>
            ))}
          </ul>
        </SectionLabel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function SectionLabel({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      {children}
    </div>
  )
}

function CopyRow({
  text,
  label,
  className,
}: {
  text: string
  label: string
  className?: string
}) {
  return (
    <div className="group flex items-start justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className={cn('min-w-0 flex-1 break-words', className)}>{text}</p>
      <button
        onClick={() => void copyToClipboard(text, label)}
        className="flex-shrink-0 text-muted-foreground transition hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function CopyBlock({
  text,
  label,
  multiline,
}: {
  text: string
  label: string
  multiline?: boolean
}) {
  return (
    <div className="group relative rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className={cn('min-w-0 flex-1 break-words text-sm text-muted-foreground', multiline && 'whitespace-pre-wrap')}>
        {text}
      </p>
      <button
        onClick={() => void copyToClipboard(text, label)}
        className="absolute right-2 top-2 text-muted-foreground transition hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function KVCard({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-medium', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-tab generator (original 4 tabs)
// ---------------------------------------------------------------------------

interface TabGeneratorProps {
  tab: TabDef
}

function TabGenerator({ tab }: TabGeneratorProps) {
  const [brief, setBrief] = React.useState('')
  const [platform, setPlatform] = React.useState(tab.platforms[0].value)
  const [generating, setGenerating] = React.useState(false)
  const [result, setResult] = React.useState<MarketingResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Reset state when switching tabs (the parent unmounts/remounts on tab change
  // via TabsContent, but reset just in case the same component is reused).
  React.useEffect(() => {
    setBrief('')
    setPlatform(tab.platforms[0].value)
    setResult(null)
    setError(null)
  }, [tab.value])

  async function handleGenerate() {
    if (brief.trim().length < 8) {
      toast.error('Please describe the campaign in at least a sentence.')
      return
    }
    setGenerating(true)
    setError(null)
    const t = toast.loading(`Generating ${tab.label} campaign…`)
    try {
      const res = await postGenerate({
        type: tab.value,
        platform,
        description: brief.trim(),
      })
      setResult(res)
      toast.dismiss(t)
      if (res.parseError) {
        toast.warning('Generated with a parse warning.', {
          description: res.parseError,
        })
      } else {
        toast.success(`${tab.label} campaign generated.`)
      }
    } catch (err) {
      toast.dismiss(t)
      const msg = err instanceof Error ? err.message : 'generation_failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setGenerating(false)
    }
  }

  function handleReset() {
    setResult(null)
    setError(null)
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className={cn('bg-gradient-to-br text-white', tab.gradient)}>
          <CardTitle className="flex items-center gap-2 text-lg">
            {tab.icon}
            {tab.label} Campaign
          </CardTitle>
          <CardDescription className="text-white/80">{tab.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Platform</p>
            <div className="flex flex-wrap gap-2">
              {tab.platforms.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPlatform(p.value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition',
                    platform === p.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground/40',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Brief — what are you promoting?
            </p>
            <Textarea
              placeholder={tab.placeholder}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              className="resize-none"
              maxLength={1000}
            />
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{brief.length} / 1000</span>
              <span>{brief.trim().length >= 8 ? 'Ready' : 'At least 8 characters'}</span>
            </div>
          </div>

          {tab.examples.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Or try an example:</p>
              <div className="flex flex-col gap-1">
                {tab.examples.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setBrief(ex)}
                    className="rounded-md border border-border bg-muted/30 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition hover:border-foreground/40 hover:text-foreground"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={handleGenerate}
            disabled={generating || brief.trim().length < 8}
            className={cn('w-full gap-2 bg-gradient-to-r text-white hover:opacity-90', tab.gradient)}
            size="lg"
          >
            {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
            Generate {tab.label} campaign
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="border-red-300 bg-red-50/30 dark:border-red-800 dark:bg-red-950/10">
              <CardContent className="p-4">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Generated campaign
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn('text-[10px]', tab.accent)}>
                        {tab.label}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {result.campaign.platform}
                      </Badge>
                      <span className="text-[10px]">
                        {formatDistanceToNow(new Date(result.campaign.createdAt), { addSuffix: true })}
                      </span>
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs">
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {tab.value === 'ads' && <AdsResult content={result.campaign.content} />}
                {tab.value === 'social' && <SocialResult content={result.campaign.content} />}
                {tab.value === 'email' && <EmailResult content={result.campaign.content} />}
                {tab.value === 'seo' && <SeoResult content={result.campaign.content} />}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ===========================================================================
// Tab 5: Ad Creatives
// ===========================================================================

interface Business {
  id: string
  name: string
  slug: string
}

function useBusinesses() {
  const [businesses, setBusinesses] = React.useState<Business[]>([])
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listBusinesses()
      .then(({ businesses }) => {
        if (!cancelled) setBusinesses(businesses)
      })
      .catch(() => {
        /* non-fatal */
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { businesses, loading }
}

function BusinessSelect({
  value,
  onChange,
  businesses,
  loading,
}: {
  value: string
  onChange: (v: string) => void
  businesses: Business[]
  loading: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={loading ? 'Loading businesses…' : 'Select a business (optional)'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">No business</SelectItem>
        {businesses.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface AdCreativesResult {
  ok: boolean
  platform: string
  variants: Record<string, unknown>[]
  targeting: Record<string, unknown>
  imageBase64: string | null
  imagePrompt: string
}

function AdCreativesTab() {
  const { businesses, loading: businessesLoading } = useBusinesses()
  const [platform, setPlatform] = React.useState<string>('meta')
  const [businessId, setBusinessId] = React.useState<string>('none')
  const [description, setDescription] = React.useState('')
  const [generating, setGenerating] = React.useState(false)
  const [result, setResult] = React.useState<AdCreativesResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    const t = toast.loading('Generating ad creatives…')
    try {
      const res = await api.generateAdCreatives({
        platform,
        businessId: businessId !== 'none' ? businessId : undefined,
        description: description.trim() || undefined,
      })
      setResult(res)
      toast.dismiss(t)
      if (!res.ok) {
        toast.warning('Ad creatives returned with a warning.')
      } else {
        toast.success('Ad creatives generated.')
      }
    } catch (err) {
      toast.dismiss(t)
      const msg = err instanceof Error ? err.message : 'generation_failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ImageIcon className="h-5 w-5" />
            Ad Creatives Studio
          </CardTitle>
          <CardDescription className="text-white/80">
            Generate visual ad images with A/B test variants and targeting suggestions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* Platform chips */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Platform</p>
            <div className="flex flex-wrap gap-2">
              {AD_PLATFORMS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPlatform(p.value)}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition',
                    platform === p.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border text-muted-foreground hover:border-foreground/40',
                  )}
                >
                  {p.icon}
                  <span className="font-medium">{p.label}</span>
                  <span className="text-[10px] opacity-70">· {p.sub}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Business select */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Business (optional)
            </p>
            <BusinessSelect
              value={businessId}
              onChange={setBusinessId}
              businesses={businesses}
              loading={businessesLoading}
            />
          </div>

          {/* Description */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Description (optional)</p>
            <Textarea
              placeholder="e.g. Black Friday promo for our AI meal-planner app, targeting busy parents."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
              maxLength={1000}
            />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">
              {description.length} / 1000
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white hover:opacity-90"
            size="lg"
          >
            {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
            Generate Ad Creatives
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="border-red-300 bg-red-50/30 dark:border-red-800 dark:bg-red-950/10">
              <CardContent className="p-4">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Ad Creatives Ready
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="bg-violet-100 text-[10px] text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                      >
                        Ad Creatives
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {result.platform}
                      </Badge>
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setResult(null)} className="text-xs">
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <AdCreativesResultCard result={result} />
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function AdCreativesResultCard({ result }: { result: AdCreativesResult }) {
  const variants = asObjectArray(result.variants)
  const targeting = asObject(result.targeting)
  const imageBase64 = asString(result.imageBase64)
  const imagePrompt = asString(result.imagePrompt)
  const platform = asString(result.platform, 'platform')

  const dataUrl = imageBase64
    ? imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`
    : null

  const interests = asStringArray(targeting.interests)
  const behaviors = asStringArray(targeting.behaviors)
  const locations = asStringArray(targeting.locations)
  const ageRange = asString(targeting.ageRange) || asString(targeting.age)

  return (
    <div className="space-y-4">
      {/* Image + prompt */}
      <div className="grid gap-4 lg:grid-cols-2">
        {dataUrl ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> Ad Creative Image
                </span>
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={dataUrl} download={`ad-creative-${platform}.png`}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-md border border-border bg-muted/30">
                <img src={dataUrl} alt={`Ad creative for ${platform}`} className="h-auto w-full" />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex aspect-video items-center justify-center p-6 text-center">
              <div>
                <ImageIcon className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No image generated for this request.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {imagePrompt && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" /> Image Prompt
              </CardTitle>
              <CardDescription>The AI-generated prompt used to render the visual.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground">
                {imagePrompt}
              </pre>
            </CardContent>
          </Card>
        )}
      </div>

      {/* A/B variants */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Target className="h-3.5 w-3.5" /> A/B Test Variants — {platform}
        </p>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No variants returned.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {variants.map((v, i) => (
              <AdVariantCard key={i} variant={v} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Targeting suggestions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Targeting Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {ageRange ? (
              <KVCard label="Age range" value={ageRange} />
            ) : (
              <KVCard label="Age range" value="—" />
            )}
            {locations.length > 0 && (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <MapPin className="h-3 w-3" /> Locations
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {locations.map((l, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                    >
                      {l}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {interests.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Interests</p>
              <div className="flex flex-wrap gap-1.5">
                {interests.map((it, i) => (
                  <span
                    key={i}
                    className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
                  >
                    {it}
                  </span>
                ))}
              </div>
            </div>
          )}

          {behaviors.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Behaviors</p>
              <div className="flex flex-wrap gap-1.5">
                {behaviors.map((b, i) => (
                  <span
                    key={i}
                    className="rounded-md bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          )}

          {ageRange === '' && interests.length === 0 && behaviors.length === 0 && locations.length === 0 && (
            <p className="text-sm text-muted-foreground">No targeting suggestions returned.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AdVariantCard({
  variant,
  index,
}: {
  variant: Record<string, unknown>
  index: number
}) {
  const headline = asString(variant.headline)
  const primaryText = asString(variant.primaryText)
  const cta = asString(variant.cta)
  const targetAudience = asString(variant.targetAudience) || asString(variant.audience)
  const objective = asString(variant.objective)
  const budget =
    asString(variant.budgetRecommendation) || asString(variant.budget) || asString(variant.budgetHint)
  const variantLabel = String.fromCharCode(65 + index) // A, B, C, …

  const copyText = [
    headline && `HEADLINE: ${headline}`,
    primaryText && `PRIMARY TEXT: ${primaryText}`,
    cta && `CTA: ${cta}`,
    targetAudience && `AUDIENCE: ${targetAudience}`,
    objective && `OBJECTIVE: ${objective}`,
    budget && `BUDGET: ${budget}`,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary" className="text-[10px]">
            Variant {variantLabel}
          </Badge>
          <button
            onClick={() => void copyToClipboard(copyText, `Variant ${variantLabel}`)}
            className="text-muted-foreground transition hover:text-foreground"
            aria-label={`Copy variant ${variantLabel}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
        {headline && <CardTitle className="text-base leading-tight font-bold">{headline}</CardTitle>}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {primaryText && <p className="text-sm text-muted-foreground">{primaryText}</p>}
        {cta && (
          <Button className="w-full gap-1.5" size="sm">
            <MousePointerClick className="h-3.5 w-3.5" /> {cta}
          </Button>
        )}
        <div className="mt-auto space-y-1.5 border-t border-border pt-2 text-xs">
          {targetAudience && (
            <p className="flex items-start gap-1.5">
              <Users className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Audience:</span>{' '}
              <span className="font-medium">{targetAudience}</span>
            </p>
          )}
          {objective && (
            <p className="flex items-start gap-1.5">
              <Target className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Objective:</span>{' '}
              <Badge variant="outline" className="text-[10px]">
                {objective}
              </Badge>
            </p>
          )}
          {budget && (
            <p className="flex items-start gap-1.5">
              <DollarSign className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">Budget:</span>{' '}
              <span className="font-medium">{budget}</span>
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ===========================================================================
// Tab 6: Email Flows
// ===========================================================================

interface EmailFlowResult {
  ok: boolean
  type: string
  flowName: string
  flow: Record<string, unknown>
}

function EmailFlowsTab() {
  const { businesses, loading: businessesLoading } = useBusinesses()
  const [flowType, setFlowType] = React.useState<'welcome' | 'abandoned_cart' | 'reengagement'>(
    'welcome',
  )
  const [businessId, setBusinessId] = React.useState<string>('none')
  const [description, setDescription] = React.useState('')
  const [generating, setGenerating] = React.useState(false)
  const [result, setResult] = React.useState<EmailFlowResult | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    const t = toast.loading('Generating email flow…')
    try {
      const res = await api.generateEmailFlow({
        type: flowType,
        businessId: businessId !== 'none' ? businessId : undefined,
        description: description.trim() || undefined,
      })
      setResult(res)
      toast.dismiss(t)
      if (!res.ok) {
        toast.warning('Email flow returned with a warning.')
      } else {
        toast.success('Email flow generated.')
      }
    } catch (err) {
      toast.dismiss(t)
      const msg = err instanceof Error ? err.message : 'generation_failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-br from-cyan-500 to-blue-600 text-white">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Workflow className="h-5 w-5" />
            Email Flow Builder
          </CardTitle>
          <CardDescription className="text-white/80">
            Generate complete automation sequences with branching logic and optimization tips.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* Flow type cards */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Flow type</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {EMAIL_FLOW_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  onClick={() => setFlowType(ft.value)}
                  className={cn(
                    'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition',
                    flowType === ft.value
                      ? 'border-cyan-500 bg-cyan-50 dark:border-cyan-400 dark:bg-cyan-950/30'
                      : 'border-border hover:border-foreground/40',
                  )}
                >
                  <span
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-md',
                      flowType === ft.value
                        ? 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {ft.icon}
                  </span>
                  <span className="text-sm font-medium">{ft.label}</span>
                  <span className="text-[11px] leading-snug text-muted-foreground">{ft.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Business select */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Business (optional)
            </p>
            <BusinessSelect
              value={businessId}
              onChange={setBusinessId}
              businesses={businesses}
              loading={businessesLoading}
            />
          </div>

          {/* Description */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Description (optional)</p>
            <Textarea
              placeholder="e.g. 4-email welcome series for a B2B project management SaaS targeting team leads."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="resize-none"
              maxLength={1000}
            />
            <div className="mt-1 text-right text-[10px] text-muted-foreground">
              {description.length} / 1000
            </div>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={generating}
            className="w-full gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:opacity-90"
            size="lg"
          >
            {generating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
            Generate Email Flow
          </Button>
        </CardContent>
      </Card>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="border-red-300 bg-red-50/30 dark:border-red-800 dark:bg-red-950/10">
              <CardContent className="p-4">
                <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {result && (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Email Flow Ready
                    </CardTitle>
                    <CardDescription className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className="bg-cyan-100 text-[10px] text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
                      >
                        Email Flow
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {result.type || flowType}
                      </Badge>
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setResult(null)} className="text-xs">
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <EmailFlowResultCard result={result} />
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function EmailFlowResultCard({ result }: { result: EmailFlowResult }) {
  const flow = asObject(result.flow)
  const flowName = asString(result.flowName) || asString(flow.flowName) || asString(flow.name)
  const triggerEvent = asString(flow.triggerEvent) || asString(flow.trigger)
  const triggerCondition = asString(flow.triggerCondition) || asString(flow.condition)
  const emails = asObjectArray(flow.emails)
  const branches = asObjectArray(flow.branches)
  const tips = asStringArray(flow.optimizationTips)

  const copyText = JSON.stringify(
    {
      flowName,
      type: result.type,
      triggerEvent,
      triggerCondition,
      emails,
      branches,
      optimizationTips: tips,
    },
    null,
    2,
  )

  return (
    <div className="space-y-4">
      {/* Overview */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Workflow className="h-4 w-4" /> {flowName || 'Email Flow'}
              </CardTitle>
              <CardDescription className="mt-1 capitalize">
                {asString(result.type, 'automation')} automation sequence
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="flex-shrink-0 gap-1.5"
              onClick={() => void copyToClipboard(copyText, 'Email flow')}
            >
              <Copy className="h-3.5 w-3.5" /> Copy flow
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <KVCard label="Trigger event" value={triggerEvent || '—'} />
            <KVCard label="Entry condition" value={triggerCondition || '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Email sequence */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Mail className="h-3.5 w-3.5" /> Email Sequence ({emails.length})
        </p>
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails returned.</p>
        ) : (
          <div className="space-y-3">
            {emails.map((email, i) => (
              <EmailStepCard key={i} email={email} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Branching logic */}
      {branches.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="h-4 w-4" /> Branching Logic
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {branches.map((b, i) => (
              <BranchDiagram key={i} branch={b} index={i} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Optimization tips */}
      {tips.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb className="h-4 w-4" /> Optimization Tips
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function EmailStepCard({
  email,
  index,
}: {
  email: Record<string, unknown>
  index: number
}) {
  const name = asString(email.name) || asString(email.stepName)
  const subject = asString(email.subject) || asString(email.subjectLine)
  const preview = asString(email.previewText) || asString(email.preview)
  const body = asString(email.body) || asString(email.content)
  const delay = asString(email.delay) || asString(email.sendDelay) || asString(email.wait)
  const goal = asString(email.goal)
  const ctaText = asString(email.ctaText) || asString(email.cta)
  const ctaUrl = asString(email.ctaUrl) || asString(email.url)

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-bold text-white">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            {name && <p className="text-sm font-medium text-muted-foreground">{name}</p>}
            {subject && <p className="mt-0.5 text-base font-bold">{subject}</p>}
            {preview && <p className="mt-0.5 text-xs text-muted-foreground">{preview}</p>}
          </div>
        </div>

        {body && (
          <ScrollArea className="h-40 w-full rounded-md border border-border bg-muted/30">
            <pre className="whitespace-pre-wrap break-words p-3 text-xs text-foreground">
              {renderTokens(body)}
            </pre>
          </ScrollArea>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {delay && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Clock className="h-3 w-3" /> {delay}
            </Badge>
          )}
          {goal && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Target className="h-3 w-3" /> {goal}
            </Badge>
          )}
        </div>

        {(ctaText || ctaUrl) && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
            <MousePointerClick className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            {ctaText && <span className="text-sm font-medium">{ctaText}</span>}
            {ctaUrl && (
              <a
                href={ctaUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
              >
                {ctaUrl}
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BranchDiagram({
  branch,
  index,
}: {
  branch: Record<string, unknown>
  index: number
}) {
  const condition = asString(branch.condition)
  const thenStep =
    asString(branch.thenStep) || asString(branch.then) || asString(branch.thenAction)
  const elseStep =
    asString(branch.elseStep) || asString(branch['else']) || asString(branch.otherwise)

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <p className="mb-3 text-xs font-medium text-muted-foreground">Branch {index + 1}</p>
      <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:justify-center">
        <div className="w-full rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-center text-xs dark:border-blue-700 dark:bg-blue-950/40 sm:w-auto">
          <span className="font-semibold text-blue-800 dark:text-blue-300">IF</span>
          <br />
          <span className="font-normal text-muted-foreground">{condition || '—'}</span>
        </div>

        <div className="flex items-center justify-center text-muted-foreground">
          <ArrowRight className="hidden h-4 w-4 sm:block" />
          <ArrowDown className="block h-4 w-4 sm:hidden" />
        </div>

        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-1">
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-700 dark:bg-emerald-950/40">
            <span className="font-semibold text-emerald-800 dark:text-emerald-300">THEN</span>
            <br />
            <span className="font-normal text-muted-foreground">{thenStep || '—'}</span>
          </div>
          <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs dark:border-rose-700 dark:bg-rose-950/40">
            <span className="font-semibold text-rose-800 dark:text-rose-300">ELSE</span>
            <br />
            <span className="font-normal text-muted-foreground">{elseStep || '—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export default function MarketingView() {
  const [activeTab, setActiveTab] = React.useState<TabValue>('ads')

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6">
      {/* Header */}
      <div className="mb-8 text-center">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight md:text-4xl"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 text-white">
            <Megaphone className="h-5 w-5" />
          </span>
          Marketing Studio
        </motion.h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
          Generate ads, social posts, email campaigns, SEO packages, ad creatives, and email flows with AI.
          Pick a channel, describe what you&apos;re promoting — get a complete package in seconds.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList className="flex w-full gap-1 overflow-x-auto sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-9">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 whitespace-nowrap text-xs sm:text-sm">
              {t.icon}
              <span>{t.label}</span>
            </TabsTrigger>
          ))}
          <TabsTrigger value="ad-creatives" className="gap-1.5 text-xs sm:text-sm">
            <ImageIcon className="h-4 w-4" />
            <span>Ad Creatives</span>
          </TabsTrigger>
          <TabsTrigger value="email-flows" className="gap-1.5 text-xs sm:text-sm">
            <Workflow className="h-4 w-4" />
            <span>Email Flows</span>
          </TabsTrigger>
          <TabsTrigger value="scheduler" className="gap-1.5 text-xs sm:text-sm">
            <CalendarClock className="h-4 w-4" />
            <span>Scheduler</span>
          </TabsTrigger>
          <TabsTrigger value="roi" className="gap-1.5 text-xs sm:text-sm">
            <TrendingUp className="h-4 w-4" />
            <span>ROI</span>
          </TabsTrigger>
          <TabsTrigger value="voice" className="gap-1.5 text-xs sm:text-sm">
            <Mic2 className="h-4 w-4" />
            <span>Voice</span>
          </TabsTrigger>
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-6">
            <TabGenerator tab={t} />
          </TabsContent>
        ))}
        <TabsContent value="ad-creatives" className="mt-6">
          <AdCreativesTab />
        </TabsContent>
        <TabsContent value="email-flows" className="mt-6">
          <EmailFlowsTab />
        </TabsContent>
        <TabsContent value="scheduler" className="mt-6">
          <SocialScheduler />
        </TabsContent>
        <TabsContent value="roi" className="mt-6">
          <RoiDashboard />
        </TabsContent>
        <TabsContent value="voice" className="mt-6">
          <BrandVoiceTrainer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
