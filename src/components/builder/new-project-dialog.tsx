'use client'

// Controlled dialog for configuring + creating a new Buildr project.
// Reads the provider catalog + integration catalog from the Zustand store
// (already booted by the dashboard). On submit it calls
// `useBuilder.createProject({ ...generate: true })` and shows a local spinner
// while the server generates the initial file set.

import * as React from 'react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import {
  Banknote,
  CreditCard,
  Database,
  Loader2,
  Mail,
  MessageSquare,
  Landmark,
  Puzzle,
  ScanFace,
  Shield,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react'

import { useBuilder } from '@/lib/store'
import type { DbConfig, IntegrationDef, StackKey, StylingKey } from '@/lib/types'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Catalogs — kept here (UI-only) so the dialog is self-describing.
// ---------------------------------------------------------------------------

interface StackOption {
  value: StackKey
  label: string
  description: string
}

const STACK_OPTIONS: StackOption[] = [
  { value: 'nextjs', label: 'Next.js 16', description: 'App Router, SSR/ISR, full-stack.' },
  { value: 'node-express', label: 'Node + Express', description: 'REST API + static SPA client.' },
  { value: 'react-vite', label: 'React + Vite', description: 'Client-side SPA, no SSR.' },
  { value: 'static-html', label: 'Static HTML', description: 'Plain HTML/CSS/JS, no framework.' },
]

interface StylingOption {
  value: StylingKey
  label: string
  description: string
}

const STYLING_OPTIONS: StylingOption[] = [
  { value: 'tailwind', label: 'Tailwind CSS', description: 'Utility-first, design tokens.' },
  { value: 'bootstrap', label: 'Bootstrap 5', description: 'Component classes, grid system.' },
  { value: 'plain', label: 'Plain CSS', description: 'Hand-written CSS, no framework.' },
]

type DbEngine = DbConfig['engine']
type DbOrm = DbConfig['orm']

interface DbEngineOption {
  value: DbEngine
  label: string
  description: string
}

const DB_ENGINE_OPTIONS: DbEngineOption[] = [
  { value: 'sqlite', label: 'SQLite', description: 'Local file DB, zero-config.' },
  { value: 'postgres', label: 'PostgreSQL', description: 'Managed or self-hosted.' },
  { value: 'mysql', label: 'MySQL', description: 'Managed or self-hosted.' },
  { value: 'supabase', label: 'Supabase', description: 'Managed Postgres + auth + storage.' },
  { value: 'none', label: 'None', description: 'No database for this project.' },
]

const DB_ORM_OPTIONS: { value: DbOrm; label: string }[] = [
  { value: 'prisma', label: 'Prisma' },
  { value: 'drizzle', label: 'Drizzle' },
  { value: 'typeorm', label: 'TypeORM' },
  { value: 'none', label: 'None (raw driver)' },
]

// Render a lucide glyph for a given catalog `icon` string. We use a switch
// (returning JSX) instead of a component map so the react-compiler
// `static-components` rule does not flag a component being created during
// render. Falls back to a puzzle piece for unknown icons.
function IntegrationIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  switch (name) {
    case 'credit-card':
      return <CreditCard className={className} />
    case 'banknote':
      return <Banknote className={className} />
    case 'shield-check':
      return <ShieldCheck className={className} />
    case 'shield':
      return <Shield className={className} />
    case 'database':
      return <Database className={className} />
    case 'mail':
      return <Mail className={className} />
    case 'message-square':
      return <MessageSquare className={className} />
    case 'landmark':
      return <Landmark className={className} />
    case 'scan-face':
      return <ScanFace className={className} />
    default:
      return <Puzzle className={className} />
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewProjectDialog({
  open,
  onOpenChange,
  initialName = '',
  initialPrompt = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Optional starting values (for example a plan worked out in AI Chat). They
  // are read when the dialog opens; the user can still edit both fields.
  initialName?: string
  initialPrompt?: string
}) {
  const seedRef = React.useRef({ name: initialName, prompt: initialPrompt })
  seedRef.current = { name: initialName, prompt: initialPrompt }
  const providers = useBuilder((s) => s.providers)
  const isAdmin = useBuilder((s) => !!s.session?.user.isAdmin)
  const integrations = useBuilder((s) => s.integrations)
  const createProject = useBuilder((s) => s.createProject)

  const [name, setName] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [stack, setStack] = React.useState<StackKey>('nextjs')
  const [styling, setStyling] = React.useState<StylingKey>('tailwind')
  const [dbEngine, setDbEngine] = React.useState<DbEngine>('sqlite')
  const [dbOrm, setDbOrm] = React.useState<DbOrm>('prisma')
  const [supabaseUrl, setSupabaseUrl] = React.useState('')
  const [supabaseAnonKey, setSupabaseAnonKey] = React.useState('')
  const [selectedIntegrations, setSelectedIntegrations] = React.useState<string[]>([])
  const [providerKey, setProviderKey] = React.useState<string>('auto')
  const [creating, setCreating] = React.useState(false)

  // Reset form whenever the dialog opens (not on close, to avoid flicker).
  React.useEffect(() => {
    if (!open) return
    setName(seedRef.current.name)
    setPrompt(seedRef.current.prompt)
    setStack('nextjs')
    setStyling('tailwind')
    setDbEngine('sqlite')
    setDbOrm('prisma')
    setSupabaseUrl('')
    setSupabaseAnonKey('')
    setSelectedIntegrations([])
    setProviderKey('auto')
    setCreating(false)
  }, [open])

  // When the engine is Supabase, force ORM to prisma (per spec — Supabase
  // projects are wired through Prisma in the generator).
  React.useEffect(() => {
    if (dbEngine === 'supabase' && dbOrm !== 'prisma') setDbOrm('prisma')
  }, [dbEngine, dbOrm])

  function toggleIntegration(key: string) {
    setSelectedIntegrations((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    )
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim() || !prompt.trim()) {
      toast.error('Project name and prompt are required.')
      return
    }
    if (dbEngine === 'supabase') {
      if (!supabaseUrl.trim() || !supabaseAnonKey.trim()) {
        toast.error('Supabase URL and anon key are required when using the Supabase engine.')
        return
      }
    }

    const dbConfig: DbConfig = {
      engine: dbEngine,
      orm: dbEngine === 'supabase' ? 'prisma' : dbOrm,
      ...(dbEngine === 'supabase'
        ? { supabaseUrl: supabaseUrl.trim(), supabaseAnonKey: supabaseAnonKey.trim() }
        : {}),
    }

    setCreating(true)
    try {
      const { project, error } = await createProject({
        name: name.trim(),
        prompt: prompt.trim(),
        stack,
        styling,
        integrations: selectedIntegrations,
        dbConfig,
        providerKey: providerKey === 'auto' ? null : providerKey,
        generate: true,
      })
      if (!project || error) {
        toast.error(error || 'Failed to create project.')
        return
      }
      toast.success('Project created. Generating initial files…')
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create_failed'
      toast.error(message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-emerald-600" />
            New project
          </DialogTitle>
          <DialogDescription>
            Describe what you want to build. The multi-LLM router picks the best model and
            generates a runnable starter in seconds.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ScrollArea className="max-h-[70vh] overflow-y-auto pr-3">
            <div className="flex flex-col gap-5 pb-2">
              {/* Basics --------------------------------------------------- */}
              <div className="flex flex-col gap-2">
                <Label htmlFor="np-name">Project name</Label>
                <Input
                  id="np-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Loan processing portal"
                  required
                  maxLength={80}
                  disabled={creating}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="np-prompt">Prompt</Label>
                <Textarea
                  id="np-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe the app you want to build — e.g. a loan processing portal with applicant KYC, document upload, and an admin dashboard"
                  required
                  rows={4}
                  disabled={creating}
                />
              </div>

              {/* Stack + styling ---------------------------------------- */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Stack">
                  <Select
                    value={stack}
                    onValueChange={(v) => setStack(v as StackKey)}
                    disabled={creating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STACK_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex flex-col items-start">
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-xs text-muted-foreground">{opt.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Styling">
                  <Select
                    value={styling}
                    onValueChange={(v) => setStyling(v as StylingKey)}
                    disabled={creating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLING_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex flex-col items-start">
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-xs text-muted-foreground">{opt.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {/* Database ------------------------------------------------ */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Database engine">
                  <Select
                    value={dbEngine}
                    onValueChange={(v) => setDbEngine(v as DbEngine)}
                    disabled={creating}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DB_ENGINE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex flex-col items-start">
                            <span className="font-medium">{opt.label}</span>
                            <span className="text-xs text-muted-foreground">{opt.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="ORM">
                  <Select
                    value={dbOrm}
                    onValueChange={(v) => setDbOrm(v as DbOrm)}
                    disabled={creating || dbEngine === 'supabase' || dbEngine === 'none'}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DB_ORM_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {dbEngine === 'supabase' && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-1 gap-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 sm:grid-cols-2"
                >
                  <Field label="Supabase URL">
                    <Input
                      value={supabaseUrl}
                      onChange={(e) => setSupabaseUrl(e.target.value)}
                      placeholder="https://xxxx.supabase.co"
                      required={dbEngine === 'supabase'}
                      disabled={creating}
                    />
                  </Field>
                  <Field label="Supabase anon key">
                    <Input
                      value={supabaseAnonKey}
                      onChange={(e) => setSupabaseAnonKey(e.target.value)}
                      placeholder="eyJhbGciOi..."
                      type="password"
                      required={dbEngine === 'supabase'}
                      disabled={creating}
                    />
                  </Field>
                </motion.div>
              )}

              {/* Integrations ------------------------------------------- */}
              <Field
                label={
                  <span className="flex items-center gap-2">
                    Integrations
                    <Badge variant="secondary" className="font-normal">
                      {selectedIntegrations.length} selected
                    </Badge>
                  </span>
                }
              >
                {integrations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Loading integration marketplace…
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {integrations.map((it) => (
                      <IntegrationToggle
                        key={it.key}
                        integration={it}
                        selected={selectedIntegrations.includes(it.key)}
                        onToggle={() => toggleIntegration(it.key)}
                        disabled={creating}
                      />
                    ))}
                  </div>
                )}
              </Field>

              {/* Provider routing --------------------------------------- */}
              {isAdmin ? (
              <Field label="Model provider">
                <Select
                  value={providerKey}
                  onValueChange={setProviderKey}
                  disabled={creating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Auto-router (recommended)</span>
                        <span className="text-xs text-muted-foreground">
                          Picks the best healthy provider per task.
                        </span>
                      </div>
                    </SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.key} value={p.key} disabled={!p.hasKey}>
                        <div className="flex flex-col items-start">
                          <span className="flex items-center gap-2 font-medium">
                            {p.name}
                            {!p.hasKey && (
                              <Badge variant="outline" className="text-[10px]">
                                no key
                              </Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {p.model} · {p.speciality}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creating || !name.trim() || !prompt.trim()}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate project
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function IntegrationToggle({
  integration,
  selected,
  onToggle,
  disabled,
}: {
  integration: IntegrationDef
  selected: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-2.5 text-left transition-colors',
        'hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-emerald-600 bg-emerald-500/10'
          : 'border-border bg-transparent',
      )}
    >
      <span
        className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border',
          selected
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-border bg-muted text-muted-foreground',
        )}
      >
        <IntegrationIcon name={integration.icon} className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{integration.name}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {integration.description}
        </span>
      </span>
    </button>
  )
}
