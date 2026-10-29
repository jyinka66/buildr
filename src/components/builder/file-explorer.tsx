'use client'

// File explorer (left sidebar inside the right pane). Renders a collapsible
// tree grouped by directory. Files are clickable to select. Generated files
// get a small Sparkles badge. A header row shows the file count + a refresh
// button. A per-file dropdown offers Delete (with confirm).

import * as React from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FileJson,
  FileText,
  FileType2,
  Folder,
  FolderOpen,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { FileView } from '@/lib/types'
import { cn } from '@/lib/utils'

// ----- tree helpers -----
interface TreeNode {
  name: string
  path: string
  isDir: boolean
  file?: FileView
  children: Record<string, TreeNode>
}

function emptyNode(name: string, path: string): TreeNode {
  return { name, path, isDir: !!name, children: {} }
}

function buildTree(files: FileView[]): TreeNode {
  const root = emptyNode('', '')
  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
    let cur = root
    parts.forEach((part, i) => {
      const childPath = parts.slice(0, i + 1).join('/')
      if (!cur.children[part]) {
        cur.children[part] = emptyNode(part, childPath)
      }
      cur = cur.children[part]
      if (i === parts.length - 1) {
        cur.isDir = false
        cur.file = f
      } else {
        cur.isDir = true
      }
    })
  }
  return root
}

function FileIcon({ language, className }: { language: string | undefined; className?: string }) {
  const lang = (language || '').toLowerCase()
  if (['json', 'jsonc', 'json5'].includes(lang)) return <FileJson className={className} />
  if (['md', 'markdown', 'mdx'].includes(lang)) return <FileText className={className} />
  if (['txt', 'env', 'ini', 'toml', 'yaml', 'yml', 'cfg'].includes(lang)) return <FileType2 className={className} />
  return <FileCode className={className} />
}

// ----- recursive tree view -----
function TreeView({ node, depth }: { node: TreeNode; depth: number }) {
  const selectedFilePath = useBuilder((s) => s.selectedFilePath)
  const selectFile = useBuilder((s) => s.selectFile)
  const deleteFile = useBuilder((s) => s.deleteFile)
  const [confirming, setConfirming] = React.useState<string | null>(null)

  const children = Object.values(node.children).sort((a, b) => {
    // directories first, then alphabetical
    if (a.isDir && !b.isDir) return -1
    if (!a.isDir && b.isDir) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <ul className={cn('flex flex-col gap-0.5', depth === 0 ? '' : '')}>
      {children.map((child) =>
        child.isDir ? (
          <DirRow key={child.path} node={child} depth={depth} />
        ) : (
          <FileRow
            key={child.path}
            file={child.file!}
            depth={depth}
            selected={selectedFilePath === child.path}
            onSelect={() => selectFile(child.path)}
            onDelete={async () => {
              setConfirming(child.path)
              await deleteFile(child.path)
              setConfirming(null)
            }}
            confirming={confirming === child.path}
          />
        ),
      )}
    </ul>
  )
}

function DirRow({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = React.useState(true)
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            style={{ paddingLeft: depth * 12 + 6 }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {open ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            ) : (
              <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            <span className="truncate">{node.name}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12 }}
          >
            <TreeView node={node} depth={depth + 1} />
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function FileRow({
  file,
  depth,
  selected,
  onSelect,
  onDelete,
  confirming,
}: {
  file: FileView
  depth: number
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  confirming: boolean
}) {
  return (
    <li>
      <div
        className={cn(
          'group/file relative flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors',
          selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )}
        style={{ paddingLeft: depth * 12 + 6 }}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <FileIcon language={file.language} className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{file.path.split('/').pop()}</span>
          {file.generated ? (
            <Badge variant="secondary" className="h-4 gap-0.5 px-1 text-[10px] text-emerald-600">
              <Sparkles className="h-2.5 w-2.5" />
              gen
            </Badge>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover/file:opacity-100 focus-visible:opacity-100"
              aria-label="File actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={confirming}>
              <Trash2 className="h-3.5 w-3.5" />
              {confirming ? 'Deleting…' : 'Delete file'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

export function FileExplorer() {
  const files = useBuilder((s) => s.files)
  const refreshFiles = useBuilder((s) => s.refreshFiles)
  const [refreshing, setRefreshing] = React.useState(false)

  const tree = React.useMemo(() => buildTree(files), [files])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshFiles()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium">Files</span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {files.length}
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto h-6 w-6"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh files"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
        </Button>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Folder className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-xs text-muted-foreground">
            No files yet — generate your first feature in chat.
          </p>
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            <TreeView node={tree} depth={0} />
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
