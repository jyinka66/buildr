'use client'

// Settings View (Module 1 + Module 4 configuration UI)
// ------------------------------------------------------------------
// Two stacked sections in a single scrollable, centered column:
//   A) LLM Providers — Multi-LLM Router configuration. Each provider
//      card exposes weight, enabled, API key, model and baseUrl controls.
//      All mutations route through `api.updateProvider` and are then
//      reflected back via `useBuilder.refreshProviders`.
//   B) Integration Marketplace — read-only catalogue (marketplace mode).
//      Per-project toggles live in the builder workspace, not here.
//
// Design constraints honoured:
//   - Mobile-first, max-w-5xl centered.
//   - Neutral zinc shadcn tokens with emerald-600 accent.
//   - lucide-react icons. framer-motion stagger.
//   - Thin scrollbar via [scrollbar-width:thin].

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import {
  Box,
  Circle,
  Cpu,
  Globe,
  KeyRound,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { ProviderConfig, ProviderKey, TaskKind } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { IntegrationMarketplace } from '@/components/builder/integration-marketplace'

type ProviderRow = ProviderConfig & { hasKey: boolean }

const providerIcon: Record<ProviderKey, LucideIcon> = {
  // Legacy key retained for type/database compatibility; router excludes it.
  zai: Sparkles,
  groq: Zap,
  openrouter: Globe,
  openai: Circle,
  anthropic: Box,
  google: Globe,
  deepseek: Cpu,
  ollama: Server,
}

const specialityBadgeClass: Record<TaskKind, string> = {
  code: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  schema: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  docs: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  general: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
}

const healthDotClass: Record<ProviderConfig['health'], string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-zinc-400',
}

const cap = (s: string): string =>
  s.charAt(0).toUpperCase() + s.slice(1)

const ROUTER_FEATURES: Array<{ icon: LucideIcon; label: string; hint: string }> = [
  { icon: Zap, label: 'Task-based routing', hint: 'code · schema · docs · general' },
  { icon: RefreshCw, label: 'Automatic failover', hint: 'next healthy provider on error' },
  { icon: ShieldCheck, label: 'Key rotation', hint: 'bring your own keys' },
  { icon: Globe, label: 'Load balancing', hint: 'weighted by speciality' },
]

function relativeTime(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

// ---------------------------------------------------------------------------
// ProviderCard — manages its own local editing state, then syncs to server.
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: ProviderRow
  onSaved: () => Promise<void>
}

function ProviderCard({ provider, onSaved }: ProviderCardProps) {
  const isZai = provider.key === 'zai'
  const isOllama = provider.key === 'ollama'
  const Icon = providerIcon[provider.key] ?? Circle

  const [weight, setWeight] = useState<number>(provider.weight)
  const [model, setModel] = useState<string>(provider.model)
  const [baseUrl, setBaseUrl] = useState<string>(provider.baseUrl ?? '')
  const [apiKey, setApiKey] = useState<string>('')
  const [open, setOpen] = useState<boolean>(false)

  const [savingWeight, setSavingWeight] = useState(false)
  const [savingEnabled, setSavingEnabled] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [savingModel, setSavingModel] = useState(false)
  const [savingBaseUrl, setSavingBaseUrl] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep local fields in sync when the store refreshes with new server data.
  useEffect(() => {
    setWeight(provider.weight)
    setModel(provider.model)
    setBaseUrl(provider.baseUrl ?? '')
  }, [provider.weight, provider.model, provider.baseUrl])

  const run = async (
    fn: () => Promise<unknown>,
    busy: (b: boolean) => void,
  ): Promise<void> => {
    busy(true)
    setError(null)
    try {
      await fn()
      await onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'update_failed'
      setError(msg)
    } finally {
      busy(false)
    }
  }

  const handleWeightCommit = (value: number[]) =>
    run(
      () => api.updateProvider({ key: provider.key, weight: value[0] }),
      setSavingWeight,
    )

  const handleEnabled = (on: boolean) =>
    run(
      () => api.updateProvider({ key: provider.key, enabled: on }),
      setSavingEnabled,
    )

  const handleSaveKey = () => {
    if (!apiKey.trim()) return
    void run(
      () =>
        api.updateProvider({ key: provider.key, apiKey: apiKey.trim() }),
      setSavingKey,
    ).then(() => setApiKey(''))
  }

  const handleSaveModel = () =>
    run(
      () => api.updateProvider({ key: provider.key, model }),
      setSavingModel,
    )

  const handleSaveBaseUrl = () =>
    run(
      () => api.updateProvider({ key: provider.key, baseUrl }),
      setSavingBaseUrl,
    )

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-2 px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'grid h-10 w-10 shrink-0 place-items-center rounded-md',
                isZai
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'bg-muted text-foreground',
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <CardTitle className="text-base">{provider.name}</CardTitle>
                {isZai && (
                  <Badge className="bg-emerald-600 text-white">Built-in</Badge>
                )}
                <Badge
                  variant="outline"
                  className={cn(
                    'capitalize',
                    specialityBadgeClass[provider.speciality],
                  )}
                >
                  {provider.speciality}
                </Badge>
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span
                    className={cn(
                      'inline-block h-2 w-2 rounded-full',
                      healthDotClass[provider.health],
                    )}
                  />
                  <span className="capitalize">{provider.health}</span>
                </span>
                <span aria-hidden>·</span>
                <span>checked {relativeTime(provider.lastChecked)}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`enabled-${provider.key}`}
              className="text-xs text-muted-foreground"
            >
              {provider.enabled ? 'On' : 'Off'}
            </Label>
            <Switch
              id={`enabled-${provider.key}`}
              checked={provider.enabled}
              onCheckedChange={handleEnabled}
              disabled={savingEnabled}
              aria-label={`Toggle ${provider.name}`}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 px-5 pb-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              Weight
              <span className="font-mono text-foreground">{weight}</span>
            </Label>
            {savingWeight && (
              <Loader2 className="text-muted-foreground h-3 w-3 animate-spin" />
            )}
          </div>
          <Slider
            value={[weight]}
            min={1}
            max={10}
            step={1}
            onValueChange={(v) => setWeight(v[0])}
            onValueCommit={handleWeightCommit}
            disabled={savingWeight}
            aria-label="Provider weight"
          />
          <p className="text-[11px] text-muted-foreground">
            Higher weight = preferred for this provider&apos;s speciality.
          </p>
        </div>

        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="text-foreground">Model:</span>{' '}
              <span className="font-mono">{provider.model}</span>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                {open ? 'Hide' : 'Configure'}
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`model-${provider.key}`} className="text-xs">
                Model name
              </Label>
              <div className="flex gap-2">
                <Input
                  id={`model-${provider.key}`}
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. gpt-4o"
                  className="h-8 font-mono text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSaveModel}
                  disabled={savingModel || model === provider.model}
                  className="h-8"
                >
                  {savingModel ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </div>

            {isOllama && (
              <div className="space-y-1.5">
                <Label htmlFor={`baseurl-${provider.key}`} className="text-xs">
                  Base URL
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`baseurl-${provider.key}`}
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="h-8 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleSaveBaseUrl}
                    disabled={
                      savingBaseUrl || baseUrl === (provider.baseUrl ?? '')
                    }
                    className="h-8"
                  >
                    {savingBaseUrl ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        <div className="space-y-2">
          {isZai ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Managed by platform — no key needed.</span>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Label
                  htmlFor={`apikey-${provider.key}`}
                  className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"
                >
                  <KeyRound className="h-3 w-3" />
                  API Key
                </Label>
                {provider.hasKey && (
                  <Badge
                    variant="outline"
                    className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  >
                    Key set
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  id={`apikey-${provider.key}`}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={provider.hasKey ? '••••••••' : 'sk-...'}
                  className="h-8 font-mono text-xs"
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSaveKey}
                  disabled={savingKey || !apiKey.trim()}
                  className="h-8"
                >
                  {savingKey ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Stored encrypted at rest. Leave blank to keep the existing key.
              </p>
            </>
          )}
        </div>

        {error && (
          <p className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SettingsView — default export. Two stacked sections.
// ---------------------------------------------------------------------------

export function SettingsView() {
  const providers = useBuilder((s) => s.providers)
  const refreshProviders = useBuilder((s) => s.refreshProviders)
  const refreshIntegrations = useBuilder((s) => s.refreshIntegrations)

  useEffect(() => {
    if (providers.length === 0) void refreshProviders()
  }, [providers.length, refreshProviders])

  useEffect(() => {
    void refreshIntegrations()
  }, [refreshIntegrations])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 [scrollbar-width:thin]">
      {/* ----------------------------------------------------------------- */}
      {/* Section A — LLM Providers                                          */}
      {/* ----------------------------------------------------------------- */}
      <section className="space-y-5">
        <header className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-emerald-600 text-white">
              <Zap className="h-4 w-4" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight">
              LLM Providers
            </h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Buildr routes every generation by task speciality, with weighted
            load balancing, automatic failover and BYO-key support. The
            built-in <span className="font-medium text-foreground">Z.ai</span>{' '}
            provider runs out of the box — add your own keys to unlock
            Anthropic, OpenAI, Gemini, DeepSeek and local Ollama.
          </p>
        </header>

        <Card className="bg-muted/30 py-0">
          <CardContent className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
            {ROUTER_FEATURES.map((f) => (
              <div
                key={f.label}
                className="flex items-start gap-2.5 rounded-md border bg-background/60 p-3"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <f.icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-medium">{f.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {f.hint}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {providers.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading providers...
          </div>
        ) : (
          <motion.div
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.05 } },
            }}
            className="grid grid-cols-1 gap-4 lg:grid-cols-2"
          >
            {providers.map((provider) => (
              <motion.div
                key={provider.id}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0 },
                }}
              >
                <ProviderCard provider={provider} onSaved={refreshProviders} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>

      <Separator className="my-10" />

      {/* ----------------------------------------------------------------- */}
      {/* Section B — Integration Marketplace                                */}
      {/* ----------------------------------------------------------------- */}
      <section className="space-y-5">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </span>
            <h2 className="text-xl font-semibold tracking-tight">
              Integration Marketplace
            </h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Browse the catalogue of pre-built integrations — payments, auth,
            communication, databases, identity and fintech. Each integration
            ships with install snippets, env var helpers and API routes.
          </p>
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            Enable integrations per-project from the builder workspace.
          </div>
        </header>

        <IntegrationMarketplace mode="marketplace" />
      </section>
    </div>
  )
}

export default SettingsView
