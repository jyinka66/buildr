'use client'

// BrandVoiceTrainer — a Marketing sub-tab for training reusable brand voice
// profiles from sample text and applying them to fresh marketing content.
// ------------------------------------------------------------------
// Sub-sections:
//   A. Profile List — cards of saved voice profiles with quick actions.
//   B. Create Profile Dialog — paste sample text → AI analyzes → review → save.
//   C. Apply Voice Dialog — pick a content type, prompt the AI in that voice.
//   D. Edit Profile Dialog — tweak tone, vocab, do/don't lists after the fact.
//
// All data flows through /api/marketing/voice/* routes. Toasts via sonner.
// Framer-motion drives the entrance animations to match the rest of Marketing.

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle2,
  Copy,
  Edit3,
  Hash,
  Loader2,
  Mic2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VoiceProfile {
  id: string
  name: string
  tone: string
  vocabulary: string[]
  sentenceStyle: string
  emojiUsage: 'minimal' | 'moderate' | 'heavy' | string
  hashtags: string[]
  doList: string[]
  dontList: string[]
  sampleText: string
  isActive: boolean
  projectId: string | null
  createdAt: string
  updatedAt: string
}

interface SimpleProject {
  id: string
  name: string
}

type ContentType = 'ads' | 'social' | 'email' | 'blog'

// ---------------------------------------------------------------------------
// Tiny fetch helpers
// ---------------------------------------------------------------------------

async function parseJson(res: Response) {
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
  return res.json()
}

async function listProfiles(): Promise<VoiceProfile[]> {
  const res = await fetch('/api/marketing/voice', { cache: 'no-store' })
  const data = await parseJson(res)
  return (data.profiles as VoiceProfile[]) ?? []
}

async function createProfile(body: { name: string; sampleText: string; projectId?: string }): Promise<VoiceProfile> {
  const res = await fetch('/api/marketing/voice', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  return data.profile as VoiceProfile
}

async function updateProfile(
  id: string,
  patch: Partial<{
    name: string
    tone: string
    sentenceStyle: string
    emojiUsage: string
    vocabulary: string[]
    hashtags: string[]
    doList: string[]
    dontList: string[]
    isActive: boolean
  }>,
): Promise<VoiceProfile> {
  const res = await fetch(`/api/marketing/voice/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await parseJson(res)
  return data.profile as VoiceProfile
}

async function deleteProfile(id: string): Promise<void> {
  const res = await fetch(`/api/marketing/voice/${id}`, { method: 'DELETE' })
  await parseJson(res)
}

async function applyVoice(body: {
  profileId: string
  prompt: string
  type: ContentType
  platform?: string
}): Promise<{ content: string; profile: { name: string; tone: string } }> {
  const res = await fetch('/api/marketing/voice/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  return { content: data.content as string, profile: data.profile as { name: string; tone: string } }
}

async function copyToClipboard(text: string, label = 'Content') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied to clipboard.`)
  } catch {
    toast.error('Could not copy to clipboard.')
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTENT_TYPES: { value: ContentType; label: string; description: string }[] = [
  { value: 'ads', label: 'Ads', description: 'Headline + description + CTA' },
  { value: 'social', label: 'Social', description: 'Caption + hashtags' },
  { value: 'email', label: 'Email', description: 'Subject + body + CTA' },
  { value: 'blog', label: 'Blog', description: 'Title + paragraphs' },
]

const PLATFORMS_BY_TYPE: Record<ContentType, { value: string; label: string }[]> = {
  ads: [
    { value: 'google', label: 'Google' },
    { value: 'meta', label: 'Meta' },
    { value: 'tiktok', label: 'TikTok' },
    { value: 'twitter', label: 'X / Twitter' },
    { value: 'linkedin', label: 'LinkedIn' },
  ],
  social: [
    { value: 'all', label: 'All platforms' },
    { value: 'linkedin', label: 'LinkedIn' },
    { value: 'twitter', label: 'X / Twitter' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'tiktok', label: 'TikTok' },
  ],
  email: [
    { value: 'all', label: 'All' },
    { value: 'newsletter', label: 'Newsletter' },
    { value: 'drip', label: 'Drip' },
    { value: 'promo', label: 'Promo' },
    { value: 'winback', label: 'Win-back' },
  ],
  blog: [
    { value: 'all', label: 'General' },
    { value: 'how-to', label: 'How-to' },
    { value: 'listicle', label: 'Listicle' },
    { value: 'comparison', label: 'Comparison' },
    { value: 'announcement', label: 'Announcement' },
  ],
}

const EMOJI_BADGE: Record<string, string> = {
  minimal: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  heavy: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BrandVoiceTrainer() {
  const [profiles, setProfiles] = React.useState<VoiceProfile[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [applyProfile, setApplyProfile] = React.useState<VoiceProfile | null>(null)
  const [editProfile, setEditProfile] = React.useState<VoiceProfile | null>(null)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await listProfiles()
      setProfiles(data)
    } catch (err) {
      toast.error('Failed to load voice profiles', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreated = React.useCallback((p: VoiceProfile) => {
    setProfiles((prev) => [p, ...prev])
    setCreateOpen(false)
    toast.success('Voice profile created.', {
      description: `“${p.name}” is ready to apply to any marketing content.`,
    })
  }, [])

  const handleUpdated = React.useCallback((p: VoiceProfile) => {
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? p : x)))
    setEditProfile(null)
    toast.success('Voice profile updated.')
  }, [])

  const handleDeleted = React.useCallback((id: string) => {
    setProfiles((prev) => prev.filter((x) => x.id !== id))
    toast.success('Voice profile deleted.')
  }, [])

  const handleToggleActive = React.useCallback(async (p: VoiceProfile, next: boolean) => {
    // Optimistic local update — the PATCH endpoint deactivates the others.
    setProfiles((prev) =>
      prev.map((x) =>
        x.id === p.id ? { ...x, isActive: next } : next ? { ...x, isActive: false } : x,
      ),
    )
    try {
      const updated = await updateProfile(p.id, { isActive: next })
      setProfiles((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      toast.success(next ? `“${p.name}” is now your active voice.` : `“${p.name}” deactivated.`)
    } catch (err) {
      // Revert on failure.
      setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, isActive: p.isActive } : x)))
      toast.error('Could not update profile.', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    }
  }, [])

  return (
    <div className="space-y-6">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
              <Mic2 className="h-4 w-4" />
            </span>
            Brand Voice Training
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Train a reusable voice profile from sample content. The AI extracts your tone, vocabulary,
            sentence style, and do/don&apos;t lists — then writes new marketing content in that exact voice.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Train New Voice
        </Button>
      </motion.div>

      {/* Profile list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading voice profiles…
        </div>
      ) : profiles.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {profiles.map((p, idx) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
            >
              <ProfileCard
                profile={p}
                onApply={() => setApplyProfile(p)}
                onEdit={() => setEditProfile(p)}
                onDelete={async () => {
                  try {
                    await deleteProfile(p.id)
                    handleDeleted(p.id)
                  } catch (err) {
                    toast.error('Failed to delete profile.', {
                      description: err instanceof Error ? err.message : 'unknown_error',
                    })
                  }
                }}
                onToggleActive={(next) => handleToggleActive(p, next)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Dialogs */}
      <CreateProfileDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={handleCreated} />

      <AnimatePresence>
        {applyProfile && (
          <ApplyVoiceDialog
            profile={applyProfile}
            open={!!applyProfile}
            onOpenChange={(open) => !open && setApplyProfile(null)}
          />
        )}
        {editProfile && (
          <EditProfileDialog
            profile={editProfile}
            open={!!editProfile}
            onOpenChange={(open) => !open && setEditProfile(null)}
            onUpdated={handleUpdated}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
          <Mic2 className="h-7 w-7" />
        </span>
        <h3 className="mt-4 text-lg font-semibold">No voice profiles yet</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Paste a sample of your existing content — a blog post, an email, a few social captions — and
          the AI will extract a reusable brand voice profile in seconds.
        </p>
        <Button onClick={onCreate} className="mt-4 gap-2">
          <Sparkles className="h-4 w-4" />
          Train your first voice
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Profile card
// ---------------------------------------------------------------------------

function ProfileCard({
  profile,
  onApply,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  profile: VoiceProfile
  onApply: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleActive: (next: boolean) => void
}) {
  const vocab = profile.vocabulary.slice(0, 5)
  const emojis = profile.emojiUsage || 'minimal'

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2 truncate text-base">
              <span className="truncate">{profile.name}</span>
              {profile.isActive && (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <CheckCircle2 className="h-3 w-3" />
                  Active
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-xs">
              {profile.tone || 'No tone extracted yet.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Label htmlFor={`active-${profile.id}`} className="sr-only">
              Active
            </Label>
            <Switch
              id={`active-${profile.id}`}
              checked={profile.isActive}
              onCheckedChange={onToggleActive}
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 pt-0">
        {/* Vocabulary chips */}
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Signature vocabulary
          </p>
          {vocab.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {vocab.map((w, i) => (
                <span
                  key={`${w}-${i}`}
                  className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                >
                  {w}
                </span>
              ))}
              {profile.vocabulary.length > 5 && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  +{profile.vocabulary.length - 5} more
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">None extracted</p>
          )}
        </div>

        {/* Sentence style + emoji usage */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sentence style</p>
            <p className="mt-0.5 line-clamp-2 font-medium">{profile.sentenceStyle || '—'}</p>
          </div>
          <div className="rounded-md bg-muted/60 px-2 py-1.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Emoji usage</p>
            <span
              className={cn(
                'mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium',
                EMOJI_BADGE[emojis] ?? EMOJI_BADGE.minimal,
              )}
            >
              {emojis}
            </span>
          </div>
        </div>

        {/* Hashtags */}
        {profile.hashtags.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            <span className="truncate">{profile.hashtags.slice(0, 4).map((h) => `#${h.replace(/^#/, '')}`).join(' ')}</span>
            {profile.hashtags.length > 4 && <span>+{profile.hashtags.length - 4}</span>}
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <Button onClick={onApply} size="sm" className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" />
            Apply Voice
          </Button>
          <Button onClick={onEdit} size="sm" variant="outline" className="gap-1.5">
            <Edit3 className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            onClick={onDelete}
            size="sm"
            variant="ghost"
            className="ml-auto gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Create Profile Dialog
// ---------------------------------------------------------------------------

function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (p: VoiceProfile) => void
}) {
  const [name, setName] = React.useState('')
  const [sampleText, setSampleText] = React.useState('')
  const [projectId, setProjectId] = React.useState<string>('')
  const [projects, setProjects] = React.useState<SimpleProject[]>([])
  const [analyzing, setAnalyzing] = React.useState(false)

  // Load projects list once the dialog opens.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/projects', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        const list = ((data.projects as { id: string; name: string }[]) ?? []).map((p) => ({
          id: p.id,
          name: p.name,
        }))
        if (!cancelled) setProjects(list)
      } catch {
        /* non-fatal — project selector is optional */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Reset the form whenever the dialog closes.
  React.useEffect(() => {
    if (!open) {
      setName('')
      setSampleText('')
      setProjectId('')
    }
  }, [open])

  const wordCount = sampleText.trim() ? sampleText.trim().split(/\s+/).length : 0

  async function handleAnalyze() {
    if (!name.trim()) {
      toast.error('Please give your voice profile a name.')
      return
    }
    if (sampleText.trim().length < 50) {
      toast.error('Please paste at least 50 characters of sample text.')
      return
    }
    setAnalyzing(true)
    const t = toast.loading('Analyzing sample text with AI…')
    try {
      const profile = await createProfile({
        name: name.trim(),
        sampleText: sampleText.trim(),
        projectId: projectId || undefined,
      })
      toast.dismiss(t)
      toast.success('Voice profile extracted.', {
        description: `Tone: ${profile.tone || '(unspecified)'}`,
      })
      onCreated(profile)
    } catch (err) {
      toast.dismiss(t)
      const msg = err instanceof Error ? err.message : 'analysis_failed'
      toast.error('Could not analyze sample.', { description: msg })
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white">
              <Mic2 className="h-4 w-4" />
            </span>
            Train New Voice
          </DialogTitle>
          <DialogDescription>
            Paste 500+ words of your existing content — a blog post, an email blast, a few captions.
            The AI will extract your tone, vocabulary, sentence style, emoji usage, do/don&apos;t lists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bv-name">Profile name</Label>
              <Input
                id="bv-name"
                placeholder="e.g. Founder's voice"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bv-project">Project (optional)</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger id="bv-project" className="w-full">
                  <SelectValue placeholder="No project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="bv-sample">Sample text</Label>
              <span
                className={cn(
                  'text-[11px]',
                  wordCount >= 100
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : wordCount > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground',
                )}
              >
                {wordCount} words
              </span>
            </div>
            <Textarea
              id="bv-sample"
              placeholder="Paste your existing content here: a blog post, an email, a few social captions, a sales page…"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              className="min-h-[220px] font-mono text-xs leading-relaxed"
            />
            <p className="text-[11px] text-muted-foreground">
              Tip: include varied samples (3-4 short pieces) so the AI can spot patterns across them.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={analyzing}>
            Cancel
          </Button>
          <Button onClick={handleAnalyze} disabled={analyzing} className="gap-2">
            {analyzing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Analyze &amp; Create
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Apply Voice Dialog
// ---------------------------------------------------------------------------

function ApplyVoiceDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: VoiceProfile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [type, setType] = React.useState<ContentType>('social')
  const [platform, setPlatform] = React.useState<string>('all')
  const [prompt, setPrompt] = React.useState('')
  const [result, setResult] = React.useState<string>('')
  const [generating, setGenerating] = React.useState(false)

  // Reset transient state when the dialog opens.
  React.useEffect(() => {
    if (open) {
      setType('social')
      setPlatform('all')
      setPrompt('')
      setResult('')
    }
  }, [open])

  // When the content type changes, reset the platform to that type's default.
  React.useEffect(() => {
    setPlatform(PLATFORMS_BY_TYPE[type]?.[0]?.value ?? 'all')
  }, [type])

  async function handleGenerate() {
    if (prompt.trim().length < 8) {
      toast.error('Describe what you want to create.')
      return
    }
    setGenerating(true)
    setResult('')
    const t = toast.loading(`Generating ${type} content in “${profile.name}” voice…`)
    try {
      const out = await applyVoice({
        profileId: profile.id,
        prompt: prompt.trim(),
        type,
        platform,
      })
      setResult(out.content)
      toast.dismiss(t)
      toast.success('Content generated in your voice.')
    } catch (err) {
      toast.dismiss(t)
      const msg = err instanceof Error ? err.message : 'generation_failed'
      toast.error('Could not generate content.', { description: msg })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-600" />
            Apply “{profile.name}” Voice
          </DialogTitle>
          <DialogDescription>
            Tone: {profile.tone || '(unspecified)'} · Emoji usage: {profile.emojiUsage}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Content type</Label>
              <Select value={type} onValueChange={(v) => setType(v as ContentType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map((ct) => (
                    <SelectItem key={ct.value} value={ct.value}>
                      <span className="flex flex-col">
                        <span>{ct.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Platform / variant</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(PLATFORMS_BY_TYPE[type] ?? []).map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bv-prompt">What do you want to create?</Label>
            <Textarea
              id="bv-prompt"
              placeholder="e.g. Announce our $5M seed round and tease the new AI feature launching next month."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          {/* Result */}
          {(generating || result) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Generated content</p>
                {result && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => copyToClipboard(result, 'Content')}
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                )}
              </div>
              <div className="relative rounded-md border bg-muted/30 p-3">
                {generating ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Writing in “{profile.name}” voice…
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                    {result}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={handleGenerate} disabled={generating} className="gap-2">
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Edit Profile Dialog
// ---------------------------------------------------------------------------

function EditProfileDialog({
  profile,
  open,
  onOpenChange,
  onUpdated,
}: {
  profile: VoiceProfile
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: (p: VoiceProfile) => void
}) {
  const [name, setName] = React.useState(profile.name)
  const [tone, setTone] = React.useState(profile.tone)
  const [sentenceStyle, setSentenceStyle] = React.useState(profile.sentenceStyle)
  const [emojiUsage, setEmojiUsage] = React.useState(profile.emojiUsage || 'minimal')
  const [vocabulary, setVocabulary] = React.useState(profile.vocabulary.join(', '))
  const [hashtags, setHashtags] = React.useState(profile.hashtags.join(', '))
  const [doList, setDoList] = React.useState(profile.doList.join('\n'))
  const [dontList, setDontList] = React.useState(profile.dontList.join('\n'))
  const [saving, setSaving] = React.useState(false)

  // Re-sync local state when the profile prop changes (i.e. dialog re-opens).
  React.useEffect(() => {
    setName(profile.name)
    setTone(profile.tone)
    setSentenceStyle(profile.sentenceStyle)
    setEmojiUsage(profile.emojiUsage || 'minimal')
    setVocabulary(profile.vocabulary.join(', '))
    setHashtags(profile.hashtags.join(', '))
    setDoList(profile.doList.join('\n'))
    setDontList(profile.dontList.join('\n'))
  }, [profile])

  function splitCommas(s: string): string[] {
    return s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  }
  function splitLines(s: string): string[] {
    return s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Profile name cannot be empty.')
      return
    }
    setSaving(true)
    try {
      const updated = await updateProfile(profile.id, {
        name: name.trim(),
        tone: tone.trim(),
        sentenceStyle: sentenceStyle.trim(),
        emojiUsage,
        vocabulary: splitCommas(vocabulary),
        hashtags: splitCommas(hashtags),
        doList: splitLines(doList),
        dontList: splitLines(dontList),
      })
      onUpdated(updated)
    } catch (err) {
      toast.error('Could not save profile.', {
        description: err instanceof Error ? err.message : 'unknown_error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="h-4 w-4" />
            Edit “{profile.name}”
          </DialogTitle>
          <DialogDescription>
            Tweak the AI-extracted fields. Vocab and hashtags are comma-separated; do/don&apos;t lists are one item per line.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-name">Profile name</Label>
              <Input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Emoji usage</Label>
              <Select value={emojiUsage} onValueChange={setEmojiUsage}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimal">Minimal</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="heavy">Heavy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-tone">Tone</Label>
            <Input
              id="ep-tone"
              placeholder="e.g. professional yet warm"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-style">Sentence style</Label>
            <Input
              id="ep-style"
              placeholder="e.g. short punchy sentences"
              value={sentenceStyle}
              onChange={(e) => setSentenceStyle(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-vocab">Signature vocabulary (comma-separated)</Label>
            <Textarea
              id="ep-vocab"
              placeholder="ship, builder-led, telemetry, ..." 
              value={vocabulary}
              onChange={(e) => setVocabulary(e.target.value)}
              className="min-h-[60px] text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ep-hash">Hashtags (comma-separated)</Label>
            <Input
              id="ep-hash"
              placeholder="buildr, no-code, ..."
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ep-do">Do list (one per line)</Label>
              <Textarea
                id="ep-do"
                placeholder={"Lead with the benefit\nUse second-person voice"}
                value={doList}
                onChange={(e) => setDoList(e.target.value)}
                className="min-h-[100px] text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ep-dont">Don&apos;t list (one per line)</Label>
              <Textarea
                id="ep-dont"
                placeholder={"Avoid hype adjectives\nNo exclamation marks"}
                value={dontList}
                onChange={(e) => setDontList(e.target.value)}
                className="min-h-[100px] text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Save changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
