'use client'

// Compact provider switcher dropdown. Shows the active provider with a small
// health dot. Lists all providers from the store; clicking sets the active
// provider (or null for "Auto-route"). The built-in `zai` provider is tagged
// with a "built-in" badge. Default selection is "Auto-route (recommended)".

import * as React from 'react'
import { Check, ChevronDown, Circle, Route, Zap } from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const healthDotClass: Record<'healthy' | 'degraded' | 'down', string> = {
  healthy: 'bg-emerald-500',
  degraded: 'bg-amber-500',
  down: 'bg-zinc-400',
}

const healthLabel: Record<'healthy' | 'degraded' | 'down', string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  down: 'Offline',
}

export function ProviderSwitcher() {
  const providers = useBuilder((s) => s.providers)
  const activeProviderKey = useBuilder((s) => s.activeProviderKey)
  const isAdmin = useBuilder((s) => !!s.session?.user.isAdmin)
  const setActiveProvider = useBuilder((s) => s.setActiveProvider)

  const activeProvider = providers.find((p) => p.key === activeProviderKey) ?? null

  const triggerLabel = activeProvider
    ? `${activeProvider.name}`
    : 'Auto-route'

  const triggerDotClass = activeProvider
    ? healthDotClass[activeProvider.health]
    : 'bg-emerald-500'

  if (!isAdmin) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2 px-2.5"
          aria-label="Switch AI provider"
        >
          <Route className="h-3.5 w-3.5 text-emerald-600" />
          <span className="hidden max-w-[8rem] truncate sm:inline">{triggerLabel}</span>
          <span className="sm:hidden">AI</span>
          <span className={cn('h-2 w-2 rounded-full', triggerDotClass)} aria-hidden />
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">
          AI Provider
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => setActiveProvider(null)}
          className="gap-2"
        >
          <Zap className="h-4 w-4 text-emerald-600" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">Auto-route</span>
            <span className="text-xs text-muted-foreground">Recommended · picks best provider</span>
          </div>
          {activeProviderKey === null ? <Check className="h-4 w-4 text-emerald-600" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {providers.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">No providers configured.</div>
        ) : (
          providers.map((p) => (
            <DropdownMenuItem
              key={p.key}
              disabled={!p.enabled || p.health === 'down' || (p.key !== 'zai' && !p.hasKey)}
              onSelect={() => setActiveProvider(p.key)}
              className="gap-2"
            >
              <span
                className={cn('h-2 w-2 shrink-0 rounded-full', healthDotClass[p.health])}
                aria-label={healthLabel[p.health]}
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <span className="truncate">{p.name}</span>
                  {p.key === 'zai' ? (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
                      built-in
                    </Badge>
                  ) : null}
                  {!p.hasKey ? (
                    <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-amber-600">
                      no key
                    </Badge>
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {p.model} · {healthLabel[p.health]}
                </span>
              </div>
              {activeProviderKey === p.key ? <Check className="h-4 w-4 text-emerald-600" /> : null}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
          <Circle className="h-2 w-2 fill-emerald-500 text-emerald-500" />
          <span>Health checked periodically</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
