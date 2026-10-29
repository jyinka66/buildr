'use client'

// Integration Marketplace (Module 4 UI)
// ------------------------------------------------------------------
// Reusable grid of integrations. Two modes:
//   - 'marketplace': read-only catalogue browsing. Each card shows
//     category, description, env vars, and a "View details" dialog with
//     a usage snippet stub.
//   - 'project': toggles bound to the current project's enabled
//     integrations. Optimistic UI via useBuilder.updateProjectIntegrations.
//
// Design constraints honoured:
//   - Mobile-first responsive grid (1 / 2 / 3 cols).
//   - Neutral zinc shadcn tokens with emerald/teal/amber/rose category
//     accents (NO indigo/blue/violet).
//   - framer-motion stagger entrance.
//   - Thin scrollbar via [scrollbar-width:thin].

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Boxes,
  CreditCard,
  Database,
  KeyRound,
  Landmark,
  Mail,
  ScanFace,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'

import { useBuilder } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { IntegrationDef } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

export interface IntegrationMarketplaceProps {
  mode: 'marketplace' | 'project'
}

type CategoryFilter = IntegrationDef['category'] | 'all'

const CATEGORIES: CategoryFilter[] = [
  'all',
  'payments',
  'auth',
  'communication',
  'database',
  'identity',
  'fintech',
]

const categoryIcon: Record<IntegrationDef['category'], LucideIcon> = {
  payments: CreditCard,
  auth: ShieldCheck,
  communication: Mail,
  database: Database,
  identity: ScanFace,
  fintech: Landmark,
}

const categoryBadgeClass: Record<IntegrationDef['category'], string> = {
  payments: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  auth: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  communication: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  database: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  identity: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  fintech: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
}

const snippetForCategory: Record<IntegrationDef['category'], string> = {
  payments: `import { createPaymentClient } from "@buildr/integrations/payments"

const payments = createPaymentClient({
  secretKey: process.env.STRIPE_SECRET_KEY,
})

await payments.charges.create({ amount: 1999, currency: "usd" })`,
  auth: `import { createAuthProvider } from "@buildr/integrations/auth"

const auth = createAuthProvider({
  secret: process.env.NEXTAUTH_SECRET,
  url: process.env.NEXTAUTH_URL,
})

export const { handlers, signIn, signOut } = auth`,
  communication: `import { createMessenger } from "@buildr/integrations/communication"

const messenger = createMessenger({
  apiKey: process.env.RESEND_API_KEY,
})

await messenger.send({ to, subject, html })`,
  database: `import { createDatabase } from "@buildr/integrations/database"

const db = createDatabase({
  url: process.env.DATABASE_URL,
})

await db.query("SELECT * FROM users LIMIT 10")`,
  identity: `import { createIdentity } from "@buildr/integrations/identity"

const identity = createIdentity({
  apiToken: process.env.ONFIDO_API_TOKEN,
  region: process.env.ONFIDO_REGION,
})

await identity.verify({ applicantId })`,
  fintech: `import { createFintech } from "@buildr/integrations/fintech"

const fintech = createFintech({
  clientId: process.env.PLAID_CLIENT_ID,
  secret: process.env.PLAID_SECRET,
  env: process.env.PLAID_ENV,
})

const linkToken = await fintech.createLinkToken(userId)`,
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function IntegrationMarketplace({ mode }: IntegrationMarketplaceProps) {
  const integrations = useBuilder((s) => s.integrations)
  const currentProject = useBuilder((s) => s.currentProject)
  const updateProjectIntegrations = useBuilder((s) => s.updateProjectIntegrations)
  const refreshIntegrations = useBuilder((s) => s.refreshIntegrations)

  const [filter, setFilter] = useState<CategoryFilter>('all')
  const [search, setSearch] = useState('')
  const [active, setActive] = useState<IntegrationDef | null>(null)

  useEffect(() => {
    if (integrations.length === 0) {
      void refreshIntegrations()
    }
  }, [integrations.length, refreshIntegrations])

  const enabledSet = useMemo(
    () => new Set(currentProject?.integrations ?? []),
    [currentProject?.integrations],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return integrations.filter((i) => {
      if (filter !== 'all' && i.category !== filter) return false
      if (!q) return true
      return (
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      )
    })
  }, [integrations, filter, search])

  const handleToggle = (key: string, on: boolean) => {
    if (!currentProject) return
    const current = currentProject.integrations ?? []
    const next = on
      ? Array.from(new Set([...current, key]))
      : current.filter((k) => k !== key)
    void updateProjectIntegrations(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
                filter === c
                  ? 'border-transparent bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search integrations..."
            className="pl-8"
            aria-label="Search integrations"
          />
        </div>
      </div>

      {mode === 'project' && !currentProject ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          Open a project to manage its integrations.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          No integrations match your filter.
        </div>
      ) : (
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.04 } },
          }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {filtered.map((integration) => {
            const Icon = categoryIcon[integration.category] ?? Boxes
            const enabled = enabledSet.has(integration.key)
            return (
              <motion.div
                key={integration.key}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  show: { opacity: 1, y: 0 },
                }}
                className="h-full"
              >
                <Card className="h-full gap-4 py-5">
                  <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <CardTitle className="truncate text-base">
                            {integration.name}
                          </CardTitle>
                          <Badge
                            variant="outline"
                            className={cn(
                              'mt-1 capitalize',
                              categoryBadgeClass[integration.category],
                            )}
                          >
                            {integration.category}
                          </Badge>
                        </div>
                      </div>
                      {mode === 'marketplace' ? (
                        <Badge variant="secondary" className="shrink-0">
                          Available
                        </Badge>
                      ) : (
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) =>
                            handleToggle(integration.key, v)
                          }
                          aria-label={`Toggle ${integration.name}`}
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {integration.description}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {integration.envVars.map((env) => (
                        <span
                          key={env}
                          className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          <KeyRound className="h-2.5 w-2.5" />
                          {env}
                        </span>
                      ))}
                    </div>
                    {mode === 'marketplace' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2"
                        onClick={() => setActive(integration)}
                      >
                        View details
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      )}

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="sm:max-w-lg">
          {active && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {(() => {
                    const Icon = categoryIcon[active.category] ?? Boxes
                    return <Icon className="h-4 w-4" />
                  })()}
                  {active.name}
                  <Badge
                    variant="outline"
                    className={cn(
                      'capitalize',
                      categoryBadgeClass[active.category],
                    )}
                  >
                    {active.category}
                  </Badge>
                </DialogTitle>
                <DialogDescription>{active.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Required environment variables
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {active.envVars.map((env) => (
                      <span
                        key={env}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 font-mono text-xs"
                      >
                        <KeyRound className="h-3 w-3" />
                        {env}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Example usage
                  </h4>
                  <pre className="max-h-64 overflow-y-auto rounded-md bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100 [scrollbar-width:thin]">
                    <code>{snippetForCategory[active.category]}</code>
                  </pre>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setActive(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default IntegrationMarketplace
