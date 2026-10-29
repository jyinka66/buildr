'use client'

// Buildr — Landing Page
// Vibrant, responsive gradient design. The hero uses an animated mesh of
// gradient blobs that reposition across breakpoints (mobile / tablet / desktop)
// so the colour story adapts to every viewport. Each section carries its own
// gradient accent that flows naturally through the spectrum.

import { motion } from 'framer-motion'
import {
  ArrowRight,
  Briefcase,
  CheckCircle2,
  Code2,
  Crown,
  Eye,
  Globe,
  HeartPulse,
  LifeBuoy,
  Megaphone,
  Plug,
  Rocket,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import { useBuilder } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { PLAN_LIST } from '@/lib/plans'
import { INTEGRATION_ICONS } from '@/components/builder/brand-icons'

// Fallback integration list if store integrations aren't loaded yet.
const FALLBACK_INTEGRATIONS = [
  { key: 'stripe', name: 'Stripe', category: 'payments' },
  { key: 'paystack', name: 'Paystack', category: 'payments' },
  { key: 'razorpay', name: 'Razorpay', category: 'payments' },
  { key: 'nextauth', name: 'NextAuth', category: 'auth' },
  { key: 'clerk', name: 'Clerk', category: 'auth' },
  { key: 'resend', name: 'Resend', category: 'communication' },
  { key: 'sendgrid', name: 'SendGrid', category: 'communication' },
  { key: 'twilio', name: 'Twilio', category: 'communication' },
]

const OUTCOMES = [
  {
    icon: Code2,
    title: 'Describe it. Get a real app.',
    desc: 'Type what you want in plain English. Buildr generates a complete, runnable project with pages, API routes, database schemas, and styling — ready to deploy.',
    accent: 'from-emerald-500 via-teal-500 to-cyan-500',
    glow: 'group-hover:shadow-emerald-500/20',
  },
  {
    icon: Rocket,
    title: 'Launch a company in 60 seconds',
    desc: 'From idea to website, brand kit, legal docs, and logo. Buildr generates everything you need to start a real business — instantly.',
    accent: 'from-teal-500 via-cyan-500 to-sky-500',
    glow: 'group-hover:shadow-cyan-500/20',
  },
  {
    icon: Zap,
    title: 'Autonomous AI that builds for you',
    desc: 'Set a goal and a timeframe. God Mode decomposes it into tasks and executes autonomously — generating a complete codebase while you watch.',
    accent: 'from-cyan-500 via-sky-500 to-blue-500',
    glow: 'group-hover:shadow-sky-500/20',
  },
  {
    icon: Megaphone,
    title: 'Marketing content on demand',
    desc: 'Generate ad campaigns, social media calendars, email sequences, and SEO blog posts. Everything you need to reach customers.',
    accent: 'from-violet-500 via-purple-500 to-fuchsia-500',
    glow: 'group-hover:shadow-violet-500/20',
  },
  {
    icon: LifeBuoy,
    title: 'AI customer support helpdesk',
    desc: 'Tickets are auto-triaged, responses are drafted by AI, and customers rate the resolution. Your support runs itself.',
    accent: 'from-fuchsia-500 via-pink-500 to-rose-500',
    glow: 'group-hover:shadow-fuchsia-500/20',
  },
  {
    icon: HeartPulse,
    title: '24/7 operations + auto-heal',
    desc: 'Cron jobs run autonomously. Monitoring pings your deployments. When something breaks, AI diagnoses and fixes it — before you notice.',
    accent: 'from-rose-500 via-orange-500 to-amber-500',
    glow: 'group-hover:shadow-rose-500/20',
  },
]

// Floating gradient orbs for the hero — reposition responsively.
const ORBS = [
  // Mobile: stacked & smaller; Desktop: spread & larger
  'absolute -top-24 -left-16 h-72 w-72 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 opacity-40 blur-3xl sm:h-96 sm:w-96 md:-top-32 md:-left-24 md:h-[28rem] md:w-[28rem] md:opacity-30',
  'absolute top-10 right-0 h-64 w-64 rounded-full bg-gradient-to-br from-cyan-400 to-blue-500 opacity-40 blur-3xl sm:h-80 sm:w-80 md:top-20 md:right-10 md:h-96 md:w-96 md:opacity-30',
  'absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-gradient-to-br from-violet-400 to-fuchsia-500 opacity-30 blur-3xl sm:h-80 sm:w-80 md:h-[26rem] md:w-[26rem] md:opacity-25',
  'absolute -bottom-20 right-10 h-56 w-56 rounded-full bg-gradient-to-br from-rose-400 to-orange-400 opacity-30 blur-3xl sm:h-72 sm:w-72 md:-bottom-24 md:right-24 md:h-80 md:w-80 md:opacity-25',
]

export function LandingView() {
  const openAuth = useBuilder((s) => s.openAuth)
  const integrations = useBuilder((s) => s.integrations)

  const integrationSample = integrations.length > 0 ? integrations.slice(0, 8) : FALLBACK_INTEGRATIONS

  return (
    <div className="overflow-hidden bg-background">
      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden px-4 pb-24 pt-20 md:px-6 md:pt-28">
        {/* Responsive animated gradient mesh background */}
        <div aria-hidden className="absolute inset-0 -z-10">
          {/* Base radial gradient wash — shifts colour on dark/light */}
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.12),transparent_70%)] dark:bg-[radial-gradient(60%_50%_at_50%_0%,rgba(16,185,129,0.18),transparent_70%)]" />
          {/* Floating colour orbs — reposition per breakpoint */}
          <motion.div
            className={ORBS[0]}
            animate={{ x: [0, 20, 0], y: [0, -15, 0] }}
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
          <motion.div
            className={ORBS[1]}
            animate={{ x: [0, -25, 0], y: [0, 20, 0] }}
            transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
          />
          <motion.div
            className={ORBS[2]}
            animate={{ x: [0, 30, 0], y: [0, 10, 0] }}
            transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          />
          <motion.div
            className={ORBS[3]}
            animate={{ x: [0, -20, 0], y: [0, -25, 0] }}
            transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
          />
          {/* Fade into background at the bottom */}
          <div className="absolute bottom-0 left-0 h-40 w-full bg-gradient-to-t from-background to-transparent" />
          {/* Subtle grid overlay for depth */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(0,0,0,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.03)_1px,transparent_1px)] bg-[size:48px_48px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)]" />
        </div>

        <div className="mx-auto max-w-4xl text-center">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <Badge variant="secondary" className="mb-5 gap-1.5 border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" />
              From idea to deployed app in under a minute
            </Badge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="text-balance text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl"
          >
            Build, launch, and scale
            <span className="block bg-gradient-to-r from-emerald-600 via-teal-500 via-cyan-500 to-violet-600 bg-clip-text text-transparent">
              your entire business with AI
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted-foreground sm:text-lg"
          >
            Generate production-ready apps, launch complete companies, run autonomous operations,
            and serve customers — all powered by AI. One platform, infinite possibilities.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Button size="lg" onClick={() => openAuth('register')} className="h-12 gap-2 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 bg-[length:200%_auto] px-8 text-base text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-[position:right_center] hover:shadow-emerald-600/40">
              Start building free
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" onClick={() => openAuth('login')} className="h-12 px-8 text-base">
              Sign in
            </Button>
          </motion.div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5, delay: 0.25 }} className="mt-4 text-xs text-muted-foreground">
            No credit card required · Free forever plan · Build in any language
          </motion.p>
        </div>

        {/* Floating workspace preview */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }} className="mx-auto mt-16 max-w-5xl">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-emerald-900/10">
            <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>
              <Badge variant="secondary" className="ml-auto gap-1 text-[10px]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> live
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
              <div className="hidden bg-card p-4 md:block">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Files</p>
                <div className="space-y-1 text-xs">
                  {['src/app/page.tsx', 'src/app/api/route.ts', 'prisma/schema.prisma', 'package.json'].map((f) => (
                    <div key={f} className="flex items-center gap-1.5 truncate font-mono text-muted-foreground">
                      <Code2 className="h-3 w-3 shrink-0 text-emerald-600" />
                      <span className="truncate">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-card p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">AI Chat</p>
                <div className="space-y-2 text-xs">
                  <div className="ml-auto max-w-[80%] rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-white">Build a SaaS landing page</div>
                  <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2">Created 5 files. Your landing page is ready! ✅</div>
                </div>
              </div>
              <div className="bg-card p-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p>
                <div className="grid h-32 place-items-center rounded-lg border border-dashed border-border bg-gradient-to-br from-emerald-50 via-cyan-50 to-violet-50 dark:from-emerald-950/20 dark:via-cyan-950/20 dark:to-violet-950/20">
                  <Rocket className="mb-1 h-5 w-5 text-emerald-600" />
                  <span className="text-xs text-muted-foreground">Live preview</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ── What you can build ─────────────────────────────────────── */}
      <section className="relative border-t border-border px-4 py-14 md:px-6 md:py-20">
        {/* Soft gradient backdrop for the section */}
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/50 via-transparent to-cyan-50/30 dark:from-emerald-950/20 dark:via-transparent dark:to-cyan-950/10" />
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <Badge variant="secondary" className="mb-3 gap-1.5 bg-gradient-to-r from-emerald-50 to-cyan-50 text-emerald-700 dark:from-emerald-950/40 dark:to-cyan-950/40 dark:text-emerald-300">
              <Sparkles className="h-3 w-3" /> Capabilities
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to{' '}
              <span className="bg-gradient-to-r from-emerald-600 to-cyan-600 bg-clip-text text-transparent">ship</span>
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              One platform that generates apps, launches businesses, runs operations, and serves customers.
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {OUTCOMES.map((f, i) => (
              <motion.div key={f.title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-50px' }} transition={{ duration: 0.4, delay: i * 0.05 }}>
                <Card className={`group h-full overflow-hidden border-border/60 transition-all duration-300 hover:-translate-y-1 hover:border-transparent hover:shadow-xl ${f.glow}`}>
                  <div className={`h-1 w-full bg-gradient-to-r ${f.accent}`} />
                  <CardContent className="p-6">
                    <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${f.accent} text-white shadow-lg`}>
                      <f.icon className="h-5 w-5" />
                    </div>
                    <h3 className="mb-2 font-semibold">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Integrations with real logos ────────────────────────────── */}
      <section className="relative border-t border-border px-4 py-14 md:px-6 md:py-20">
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-50/40 via-transparent to-fuchsia-50/30 dark:from-violet-950/10 dark:via-transparent dark:to-fuchsia-950/10" />
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 text-center">
            <Badge variant="secondary" className="mb-3 gap-1.5 bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-700 dark:from-violet-950/40 dark:to-fuchsia-950/40 dark:text-violet-300">
              <Plug className="h-3 w-3" /> Integrations
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Real integrations,{' '}
              <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent">real code</span>
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
              Each integration writes real, working code into your project — payments, auth, email, SMS, and more.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {integrationSample.map((int) => {
              const BrandIcon = INTEGRATION_ICONS[int.key]
              return (
                <div key={int.key} className="group flex items-center gap-2.5 rounded-xl border border-border bg-card p-3.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-300 hover:bg-gradient-to-br hover:from-violet-50/50 hover:to-fuchsia-50/50 hover:shadow-md dark:hover:border-violet-700 dark:hover:from-violet-950/20 dark:hover:to-fuchsia-950/20">
                  {BrandIcon ? <BrandIcon className="h-6 w-6 shrink-0" /> : <Plug className="h-6 w-6 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{int.name}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{int.category}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Why Buildr ─────────────────────────────────────────────── */}
      <section className="relative border-t border-border px-4 py-14 md:px-6 md:py-20">
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-bl from-cyan-50/40 via-transparent to-teal-50/30 dark:from-cyan-950/10 dark:via-transparent dark:to-teal-950/10" />
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <Badge variant="secondary" className="mb-3 gap-1.5 bg-gradient-to-r from-cyan-50 to-teal-50 text-cyan-700 dark:from-cyan-950/40 dark:to-teal-950/40 dark:text-cyan-300">
              <ShieldCheck className="h-3 w-3" /> Why Buildr
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Not just a{' '}
              <span className="bg-gradient-to-r from-cyan-600 to-teal-600 bg-clip-text text-transparent">code generator</span>
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Buildr is a complete platform for building, launching, and running software businesses.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Users, title: 'Team Workspaces', desc: 'Invite members, share projects, collaborate in real-time', accent: 'from-emerald-500 to-teal-500' },
              { icon: ShieldCheck, title: 'Two-Factor Auth', desc: 'TOTP-based 2FA with backup codes — secure by default', accent: 'from-cyan-500 to-sky-500' },
              { icon: Crown, title: 'Admin Console', desc: 'Platform-wide stats, user management, audit logs', accent: 'from-violet-500 to-purple-500' },
              { icon: Globe, title: 'Multi-Language', desc: 'Build in your language — supports 10+ languages worldwide', accent: 'from-fuchsia-500 to-rose-500' },
            ].map((item, i) => (
              <motion.div key={item.title} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }} className="group rounded-xl border border-border bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
                <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br ${item.accent} text-white shadow-md`}>
                  <item.icon className="h-5 w-5" />
                </div>
                <p className="font-medium">{item.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────── */}
      <section className="relative border-t border-border px-4 py-14 md:px-6 md:py-20">
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-rose-50/30 via-transparent to-amber-50/20 dark:from-rose-950/10 dark:via-transparent dark:to-amber-950/10" />
        <div className="mx-auto max-w-6xl">
          <div className="mb-10 text-center">
            <Badge variant="secondary" className="mb-3 gap-1.5 bg-gradient-to-r from-rose-50 to-amber-50 text-rose-700 dark:from-rose-950/40 dark:to-amber-950/40 dark:text-rose-300">
              <Crown className="h-3 w-3" /> Pricing
            </Badge>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Start free. Upgrade when you{' '}
              <span className="bg-gradient-to-r from-rose-600 to-amber-600 bg-clip-text text-transparent">grow</span>.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              Every plan includes the full platform. Upgrade for higher limits and priority support.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PLAN_LIST.map((plan, idx) => (
              <motion.div key={plan.id} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: idx * 0.08 }} className={`relative rounded-2xl border-2 p-6 transition-all duration-300 hover:-translate-y-1 ${plan.highlighted ? 'border-emerald-400 bg-gradient-to-b from-emerald-50/60 to-cyan-50/30 shadow-xl shadow-emerald-600/10 dark:border-emerald-700 dark:from-emerald-950/30 dark:to-cyan-950/20' : 'border-border bg-card hover:border-emerald-300 hover:shadow-md'}`}>
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="gap-1 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 text-white shadow-md">
                      <Crown className="h-3 w-3" /> Most popular
                    </Badge>
                  </div>
                )}
                <p className="text-sm font-semibold">{plan.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">${plan.priceMonthly}</span>
                  <span className="text-sm text-muted-foreground">/mo</span>
                </div>
                <ul className="mt-5 space-y-2">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button className="mt-6 w-full gap-1.5" variant={plan.highlighted ? 'default' : 'outline'} onClick={() => openAuth('register')}>
                  {plan.cta}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </motion.div>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            All prices in USD. Cancel anytime. No credit card required for the Free plan.
          </p>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────── */}
      <section className="relative px-4 py-16 md:px-6 md:py-24">
        {/* Animated rainbow gradient backdrop */}
        <div aria-hidden className="absolute inset-0 -z-10 flex items-center justify-center">
          <div className="h-full w-full max-w-5xl bg-[radial-gradient(40%_60%_at_50%_50%,rgba(16,185,129,0.15),transparent_70%)]" />
        </div>
        <div className="mx-auto max-w-3xl">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 via-cyan-600 to-violet-600 bg-[length:200%_200%] p-10 text-center text-white shadow-2xl shadow-emerald-600/30 md:p-16">
            {/* Decorative blurred orbs inside the CTA card */}
            <div aria-hidden className="pointer-events-none absolute -top-10 -left-10 h-40 w-40 rounded-full bg-white/20 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-fuchsia-400/30 blur-3xl" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="relative"
            >
              <Rocket className="mx-auto mb-4 h-8 w-8 text-white/90" />
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
                Ready to build something real?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/80">
                Create a free account and generate your first app in under a minute.
              </p>
              <Button size="lg" onClick={() => openAuth('register')} className="mt-7 h-12 gap-2 bg-white px-8 text-base text-emerald-700 shadow-lg hover:bg-white/90">
                Create your account
                <ArrowRight className="h-4 w-4" />
              </Button>
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  )
}
