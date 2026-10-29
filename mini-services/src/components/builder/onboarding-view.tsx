'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, CheckCircle2, CreditCard, Code2, Sparkles, SkipForward, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const STEPS = ['welcome', 'profile', 'connect', 'tour'] as const
const LAYERS = [
  { icon: Code2, name: 'Code Builder', desc: 'Generate full-stack apps from prompts' },
  { icon: Sparkles, name: 'Business Launch', desc: 'Idea → company in 60 seconds' },
  { icon: Zap, name: 'God Mode', desc: 'Autonomous goal execution' },
  { icon: CreditCard, name: 'Billing', desc: '4 tiers, metered limits' },
]

export default function OnboardingView() {
  const step = useBuilder((s) => s.onboardingStep || 'welcome')
  const setStep = useBuilder((s) => s.openOnboarding)
  const complete = useBuilder((s) => s.completeOnboarding)
  const skip = useBuilder((s) => s.skipOnboarding)
  const session = useBuilder((s) => s.session)
  const [name, setName] = React.useState(session?.user?.name || '')
  const [role, setRole] = React.useState('developer')
  const [finishing, setFinishing] = React.useState(false)
  const currentIdx = Math.max(0, STEPS.indexOf((step as typeof STEPS[number]) || 'welcome'))

  async function handleNext() {
    if (currentIdx + 1 >= STEPS.length) await handleFinish()
    else {
      try { await fetch('/api/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ step: STEPS[currentIdx + 1] }) }) } catch {}
    }
  }

  async function handleFinish() {
    setFinishing(true)
    try {
      await complete({ name: name.trim() || undefined, role })
      toast.success('Welcome to Buildr! 🎉')
    } finally { setFinishing(false) }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6">
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <div key={s} className={`h-1.5 w-12 rounded-full transition-all ${i <= currentIdx ? 'bg-emerald-500' : 'bg-muted'}`} />
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
          {step === 'welcome' && (
            <Card><CardContent className="p-8 md:p-12 text-center">
              <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Welcome to Buildr!</h1>
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground md:text-base">The autonomous AI platform that builds, launches, and operates complete software companies.</p>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => skip()} className="text-xs text-muted-foreground"><SkipForward className="mr-1.5 h-3.5 w-3.5" />Skip tour</Button>
                <Button onClick={handleNext} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">Get started <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </CardContent></Card>
          )}
          {step === 'profile' && (
            <Card><CardContent className="p-8 md:p-12">
              <h2 className="text-2xl font-bold tracking-tight">Tell us about you</h2>
              <p className="mt-1 text-sm text-muted-foreground">We'll personalize your experience.</p>
              <div className="mt-6 space-y-4">
                <div className="space-y-1.5"><Label htmlFor="onboard-name">Your name</Label><Input id="onboard-name" placeholder="Ada Lovelace" value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>What best describes you?</Label><Select value={role} onValueChange={setRole}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="developer">Developer</SelectItem><SelectItem value="designer">Designer</SelectItem><SelectItem value="founder">Founder</SelectItem><SelectItem value="student">Student</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => skip()} className="text-xs text-muted-foreground"><SkipForward className="mr-1.5 h-3.5 w-3.5" />Skip</Button>
                <Button onClick={handleNext} className="gap-2">Continue <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </CardContent></Card>
          )}
          {step === 'connect' && (
            <Card><CardContent className="p-8 md:p-12">
              <h2 className="text-2xl font-bold tracking-tight">Connect an AI provider</h2>
              <p className="mt-1 text-sm text-muted-foreground">Buildr uses LLM providers to generate code. You can add one now or skip.</p>
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
                <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"><Sparkles className="h-4 w-4" />Free plan includes 50K tokens</p>
                <p className="mt-1 text-xs text-muted-foreground">Start building immediately with the free tier.</p>
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => skip()} className="text-xs text-muted-foreground"><SkipForward className="mr-1.5 h-3.5 w-3.5" />Skip</Button>
                <Button onClick={handleNext} className="gap-2">Continue <ArrowRight className="h-4 w-4" /></Button>
              </div>
            </CardContent></Card>
          )}
          {step === 'tour' && (
            <Card><CardContent className="p-8 md:p-12">
              <div className="mb-6 text-center">
                <h2 className="text-2xl font-bold tracking-tight">Your platform at a glance</h2>
                <p className="mt-1 text-sm text-muted-foreground">Buildr is multiple integrated layers. Here's what you can do.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {LAYERS.map((layer, i) => (
                  <motion.div key={layer.name} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.1 }} className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
                    <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><layer.icon className="h-4 w-4" /></span>
                    <div><p className="text-sm font-medium">{layer.name}</p><p className="truncate text-xs text-muted-foreground">{layer.desc}</p></div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => skip()} className="text-xs text-muted-foreground"><SkipForward className="mr-1.5 h-3.5 w-3.5" />Skip</Button>
                <Button onClick={handleFinish} disabled={finishing} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"><CheckCircle2 className="h-4 w-4" />{finishing ? 'Setting up…' : 'Start building'}</Button>
              </div>
            </CardContent></Card>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
