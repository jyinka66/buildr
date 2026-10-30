'use client'

// Builder workspace. Composes the top toolbar (project meta + provider switcher
// + tabs + export / deploy / back actions) with a resizable split layout:
// chat panel on the left and a tabbed content area (code / preview /
// integrations) on the right. On mobile the layout stacks vertically and the
// resizer is hidden. The Code tab nests a FileExplorer + CodeViewer (on mobile
// the explorer collapses to a horizontally scrollable chip row).

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft,
  Blocks,
  Code2,
  Eye,
  Loader2,
  Menu,
  Rocket,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { useBuilder } from '@/lib/store'
import { api } from '@/lib/api-client'
import { useIsMobile } from '@/hooks/use-mobile'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { ProviderSwitcher } from '@/components/builder/provider-switcher'
import { ChatPanel } from '@/components/builder/chat-panel'
import { FileExplorer } from '@/components/builder/file-explorer'
import { CodeViewer } from '@/components/builder/code-viewer'
import { PreviewPanel } from '@/components/builder/preview-panel'
import { ExportDialog } from '@/components/builder/export-dialog'
import type { StackKey, StylingKey } from '@/lib/types'
import { cn } from '@/lib/utils'

const STACK_LABEL: Record<StackKey, string> = {
  nextjs: 'Next.js',
  'node-express': 'Node + Express',
  'react-vite': 'React + Vite',
  'static-html': 'Static HTML',
}

const STYLING_LABEL: Record<StylingKey, string> = {
  tailwind: 'Tailwind',
  bootstrap: 'Bootstrap',
  plain: 'Plain CSS',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  'preview-ready': 'Preview ready',
  deployed: 'Deployed',
  error: 'Error',
}

const STATUS_CLASS: Record<string, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  'preview-ready': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  deployed: 'border-emerald-500/40 bg-emerald-600 text-white',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
}

export function BuilderWorkspace() {
  const currentProject = useBuilder((s) => s.currentProject)
  const builderTab = useBuilder((s) => s.builderTab)
  const setBuilderTab = useBuilder((s) => s.setBuilderTab)
  const closeProject = useBuilder((s) => s.closeProject)
  const converse = useBuilder((s) => s.converse)

  const isMobile = useIsMobile()

  const [exportOpen, setExportOpen] = React.useState(false)
  const [deploying, setDeploying] = React.useState(false)

  if (!currentProject) {
    return <WorkspaceSkeleton />
  }

  const handleDeploy = async () => {
    setDeploying(true)
    try {
      await api.deploy(currentProject.id, 'preview')
      toast.success('Deploy started', {
        description: 'Preview deployment queued. We will notify you when it is live.',
      })
    } catch (err) {
      toast.error('Deploy failed', {
        description: err instanceof Error ? err.message : 'deploy_failed',
      })
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      {/* toolbar */}
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          onClick={closeProject}
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Back</span>
        </Button>
        <Separator orientation="vertical" className="hidden h-5 sm:block" />

        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{currentProject.name}</span>
          <Badge
            variant="outline"
            className={cn('h-5 px-1.5 text-[10px] capitalize', STATUS_CLASS[currentProject.status])}
          >
            {STATUS_LABEL[currentProject.status] ?? currentProject.status}
          </Badge>
          <Badge variant="secondary" className="hidden h-5 px-1.5 text-[10px] md:inline-flex">
            {STACK_LABEL[currentProject.stack]}
          </Badge>
          <Badge variant="secondary" className="hidden h-5 px-1.5 text-[10px] md:inline-flex">
            {STYLING_LABEL[currentProject.styling]}
          </Badge>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <ProviderSwitcher />

          <Separator orientation="vertical" className="mx-0.5 hidden h-5 sm:block" />

          <Tabs
            value={builderTab}
            onValueChange={(v) => setBuilderTab(v as 'code' | 'preview' | 'integrations')}
            className="hidden sm:flex"
          >
            <TabsList className="h-8">
              <TabsTrigger value="code" className="gap-1 px-2 text-xs">
                <Code2 className="h-3.5 w-3.5" /> Code
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1 px-2 text-xs">
                <Eye className="h-3.5 w-3.5" /> Preview
              </TabsTrigger>
              <TabsTrigger value="integrations" className="gap-1 px-2 text-xs">
                <Blocks className="h-3.5 w-3.5" /> Integrations
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Mobile: tab dropdown as a single button cycling values is awkward; use a compact TabsList */}
          <Tabs
            value={builderTab}
            onValueChange={(v) => setBuilderTab(v as 'code' | 'preview' | 'integrations')}
            className="flex sm:hidden"
          >
            <TabsList className="h-8">
              <TabsTrigger value="code" className="px-2 text-xs">
                <Code2 className="h-3.5 w-3.5" />
              </TabsTrigger>
              <TabsTrigger value="preview" className="px-2 text-xs">
                <Eye className="h-3.5 w-3.5" />
              </TabsTrigger>
              <TabsTrigger value="integrations" className="px-2 text-xs">
                <Blocks className="h-3.5 w-3.5" />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 px-2.5"
            onClick={() => setExportOpen(true)}
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Export</span>
          </Button>
          <Button
            size="sm"
            className="h-8 gap-1.5 px-2.5"
            onClick={handleDeploy}
            disabled={deploying}
          >
            {deploying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Rocket className="h-3.5 w-3.5" />
            )}
            <span className="hidden md:inline">Deploy</span>
          </Button>
        </div>
      </div>

      {/* mobile tab strip (sm:hidden because we render compact icons in the toolbar on mobile) */}
      {/* main */}
      <div className="min-h-0 flex-1">
        {isMobile ? (
          <MobileLayout builderTab={builderTab} onSend={(m) => void converse(m)} />
        ) : (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={32} minSize={22} maxSize={45} className="min-w-[320px]">
              <ChatPanel onSend={(m) => void converse(m)} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={68} minSize={40}>
              <TabbedContent builderTab={builderTab} />
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        projectId={currentProject.id}
      />
    </div>
  )
}

function TabbedContent({ builderTab }: { builderTab: 'code' | 'preview' | 'integrations' }) {
  return (
    <div className="h-full">
      <AnimatePresence mode="wait">
        {builderTab === 'code' ? (
          <motion.div
            key="code"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            <CodeTab />
          </motion.div>
        ) : builderTab === 'preview' ? (
          <motion.div
            key="preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            <PreviewPanel />
          </motion.div>
        ) : (
          <motion.div
            key="integrations"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-full"
          >
            <IntegrationsTab />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CodeTab() {
  const isMobile = useIsMobile()
  const selectedFilePath = useBuilder((s) => s.selectedFilePath)
  const [explorerOpen, setExplorerOpen] = React.useState(false)

  if (isMobile) {
    return (
      <div className="flex h-full flex-col bg-background">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Sheet open={explorerOpen} onOpenChange={setExplorerOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
                <Menu className="h-3.5 w-3.5" /> Files
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0 sm:max-w-xs">
              <SheetHeader className="px-3 py-2">
                <SheetTitle className="text-sm">Files</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1">
                <FileExplorer />
              </div>
            </SheetContent>
          </Sheet>

          <span className="truncate font-mono text-xs text-muted-foreground">
            {selectedFilePath ?? 'no file selected'}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <CodeViewer />
        </div>
      </div>
    )
  }

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
        <FileExplorer />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize={80} minSize={40}>
        <CodeViewer />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function MobileLayout({ builderTab, onSend }: { builderTab: 'code' | 'preview' | 'integrations'; onSend: (m: string) => void }) {
  // On mobile, chat is on top taking ~40% height and tabbed content fills the rest.
  return (
    <div className="flex h-full flex-col">
      <div className="h-[38%] min-h-[12rem] border-b border-border">
        <ChatPanel onSend={onSend} />
      </div>
      <div className="min-h-0 flex-1">
        <TabbedContent builderTab={builderTab} />
      </div>
    </div>
  )
}

function IntegrationsTab() {
  const integrations = useBuilder((s) => s.integrations)
  const currentProject = useBuilder((s) => s.currentProject)
  const updateProjectIntegrations = useBuilder((s) => s.updateProjectIntegrations)
  const [pending, setPending] = React.useState(false)

  if (!currentProject) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No project loaded.
      </div>
    )
  }

  const enabled = new Set(currentProject.integrations)

  const toggle = async (key: string) => {
    const next = new Set(enabled)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPending(true)
    try {
      await updateProjectIntegrations(Array.from(next))
      toast.success('Integrations updated')
    } catch (err) {
      toast.error('Update failed', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setPending(false)
    }
  }

  // Group by category.
  const byCategory = integrations.reduce<Record<string, typeof integrations>>((acc, it) => {
    ;(acc[it.category] = acc[it.category] || []).push(it)
    return acc
  }, {})

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Blocks className="h-4 w-4 text-emerald-600" />
        <span className="text-sm font-medium">Integrations</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {enabled.size} enabled · {integrations.length} available
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {integrations.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No integrations available. Configure some in settings.
          </p>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            {Object.entries(byCategory).map(([cat, items]) => (
              <div key={cat} className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {cat}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((it) => {
                    const isOn = enabled.has(it.key)
                    return (
                      <label
                        key={it.key}
                        htmlFor={`int-${it.key}`}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-accent/40',
                          isOn && 'border-emerald-500/40 bg-emerald-500/5',
                        )}
                      >
                        <Checkbox
                          id={`int-${it.key}`}
                          checked={isOn}
                          disabled={pending}
                          onCheckedChange={() => void toggle(it.key)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{it.name}</span>
                            {it.enabled ? null : (
                              <Badge variant="outline" className="h-4 px-1 text-[10px] text-amber-600">
                                not configured
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">{it.description}</p>
                          {it.envVars.length > 0 ? (
                            <p className="mt-1 text-[11px] text-muted-foreground/80">
                              Requires: {it.envVars.join(', ')}
                            </p>
                          ) : null}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkspaceSkeleton() {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-background">
      <div className="flex h-12 items-center gap-2 border-b border-border px-3">
        <Skeleton className="h-6 w-6 rounded" />
        <Skeleton className="h-5 w-32" />
        <div className="ml-auto flex items-center gap-2">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className="flex h-full">
          <div className="hidden w-1/3 min-w-[320px] border-r border-border p-4 md:block">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-32 w-full" />
          </div>
          <div className="flex-1 p-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-4 h-[60vh] w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}
