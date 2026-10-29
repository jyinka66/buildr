'use client'

// Template gallery — renders the 5 built-in PROJECT_TEMPLATES as selectable
// cards. Used inside NewProjectDialog so a user can one-click seed the form
// (name + prompt + stack + styling) from a curated starting point.

import * as React from 'react'
import { motion } from 'framer-motion'
import { FileText, LayoutDashboard, Rocket, Server, User } from 'lucide-react'

import { PROJECT_TEMPLATES } from '@/lib/project-templates'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface TemplatePick {
  key: string
  name: string
  description: string
  stack: string
  styling: string
  prompt: string
}

// Map the icon string stored on a template to a lucide component. Returns a
// function component so React treats it as a stable reference (avoids the
// react-hooks/static-components lint rule that fires when a component is
// created during render).
function iconFor(name: string): React.ComponentType<{ className?: string }> {
  switch (name) {
    case 'Rocket':
      return Rocket
    case 'LayoutDashboard':
      return LayoutDashboard
    case 'Server':
      return Server
    case 'FileText':
      return FileText
    case 'User':
      return User
    default:
      return Rocket
  }
}

export function TemplateGallery({
  onSelect,
}: {
  onSelect: (t: TemplatePick) => void
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {PROJECT_TEMPLATES.map((tpl, i) => {
        const Icon = iconFor(tpl.icon)
        return (
          <motion.button
            key={tpl.key}
            type="button"
            onClick={() =>
              onSelect({
                key: tpl.key,
                name: tpl.name,
                description: tpl.description,
                stack: tpl.stack,
                styling: tpl.styling,
                prompt: tpl.prompt,
              })
            }
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: Math.min(i * 0.04, 0.24) }}
            className={cn(
              'group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition-all',
              'hover:border-emerald-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40',
            )}
          >
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-emerald-500/10 text-emerald-600">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-sm font-semibold text-foreground">
                {tpl.name}
              </span>
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {tpl.description}
            </p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              <Badge
                variant="secondary"
                className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                {tpl.stack}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {tpl.styling}
              </Badge>
            </div>
          </motion.button>
        )
      })}
    </div>
  )
}
