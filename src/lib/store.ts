'use client'

// Global UI state for Buildr. Drives view switching, project selection,
// provider selection and toast-free status flags. Server state (projects,
// files, generations) is fetched via the api client and cached here.

import { classifyIntent } from '@/lib/chat-intent'
import { create } from 'zustand'
import { api, type CreateProjectInput, type SessionInfo } from '@/lib/api-client'
import { streamChat } from '@/lib/chat-client'
import type {
  FileView,
  GenerationView,
  IntegrationDef,
  ProjectView,
  ProviderConfig,
} from '@/lib/types'

export type View = 'landing' | 'builder' | 'settings' | 'business' | 'godmode' | 'billing' | 'marketing' | 'support' | 'ops' | 'notifications' | 'api-keys' | 'webhooks' | 'workspaces' | 'admin' | 'onboarding' | 'jobs' | 'analytics' | 'shared' | 'chat'
export type AuthMode = 'login' | 'register' | 'forgot' | 'reset'
// How the project chat treats a message: let the AI decide (auto), only talk
// (chat), or always build (build — the original behaviour).
export type ChatMode = 'auto' | 'chat' | 'build'

// Holds the in-flight project chat request so Stop can cancel it.
let projectChatAbort: AbortController | null = null

interface BuilderState {
  view: View
  session: SessionInfo | null
  authReady: boolean
  authOpen: boolean
  authMode: AuthMode
  authLoading: boolean
  authError: string | null
  projects: ProjectView[]
  projectsLoading: boolean
  currentProject: ProjectView | null
  files: FileView[]
  generations: GenerationView[]
  selectedFilePath: string | null
  builderTab: 'code' | 'preview' | 'integrations'
  providers: (ProviderConfig & { hasKey: boolean })[]
  integrations: IntegrationDef[]
  activeProviderKey: string | null
  generating: boolean
  generatingError: string | null
  chatMode: ChatMode
  // True while a conversational (not build) reply is streaming; Stop applies.
  chatStreaming: boolean
  bootError: string | null
  booted: boolean
  sharedProject: { project: { name: string; slug: string; description: string; stack: string; styling: string }; files: { path: string; language: string; generated: boolean }[]; previewUrl: string } | null

  // actions
  boot: () => Promise<void>
  refreshProjects: () => Promise<void>
  openLanding: () => void
  openDashboard: () => void
  openBuilder: (projectId: string) => Promise<void>
  openSettings: () => Promise<void>
  openBusiness: () => Promise<void>
  openJobs: () => Promise<void>
  openGodMode: () => Promise<void>
  openBilling: () => void
  openMarketing: () => Promise<void>
  openSupport: () => Promise<void>
  openOps: () => Promise<void>
  openNotifications: () => Promise<void>
  openAnalytics: () => Promise<void>
  openApiKeys: () => Promise<void>
  openWebhooks: () => Promise<void>
  openWorkspaces: () => Promise<void>
  openAdmin: () => void
  openOnboarding: () => void
  // 2FA
  twoFactorRequired: boolean
  twoFactorEmail: string
  twoFactorPassword: string
  completeTwoFactor: (code: string) => Promise<boolean>
  cancelTwoFactor: () => void
  // Account recovery + verification
  authNotice: string | null
  unverifiedEmail: string | null
  resetToken: string | null
  forgotPassword: (email: string) => Promise<boolean>
  openReset: (token: string) => void
  resetPassword: (password: string) => Promise<boolean>
  resendVerification: () => Promise<boolean>
  showAuthError: (message: string) => void
  finishLogin: () => Promise<boolean>
  // Onboarding
  onboardingRequired: boolean
  onboardingStep: string
  checkOnboarding: () => Promise<void>
  completeOnboarding: (body: { name?: string; role?: string }) => Promise<void>
  skipOnboarding: () => Promise<void>
  openAuth: (mode: AuthMode) => void
  closeAuth: () => void
  setAuthMode: (mode: AuthMode) => void
  register: (input: { email: string; password: string; name?: string }) => Promise<boolean>
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  createProject: (input: CreateProjectInput) => Promise<{ project: ProjectView | null; error?: string }>
  deleteProject: (id: string) => Promise<void>
  closeProject: () => void
  selectFile: (path: string | null) => void
  setBuilderTab: (tab: 'code' | 'preview' | 'integrations') => void
  setActiveProvider: (key: string | null) => void
  generate: (message: string) => Promise<void>
  // Project chat: answers, plans and explains, and hands real build requests to generate().
  converse: (message: string) => Promise<void>
  stopChat: () => void
  setChatMode: (mode: ChatMode) => void
  openChat: () => void
  saveFile: (path: string, content: string, language?: string) => Promise<void>
  deleteFile: (path: string) => Promise<void>
  refreshProviders: () => Promise<void>
  refreshIntegrations: () => Promise<void>
  updateProjectIntegrations: (integrations: string[]) => Promise<void>
  refreshFiles: () => Promise<void>
}

async function getCsrf(): Promise<string> {
  const res = await fetch('/api/auth/csrf', { cache: 'no-store' })
  if (!res.ok) return ''
  const data = await res.json()
  return (data as { csrfToken?: string }).csrfToken ?? ''
}

// User-facing text for the error codes returned by credentials sign-in.
export const AUTH_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Invalid email or password.',
  EmailNotVerified: 'Your email is not verified yet. Check your inbox for the confirmation link.',
  AccountDisabled: 'This account has been disabled. Contact support if you think this is a mistake.',
  RateLimited: 'Too many attempts. Please wait a few minutes and try again.',
  TwoFactorRequired: 'Enter the 6-digit code from your authenticator app.',
  InvalidTotp: 'That code is not valid. Check your authenticator app or use a backup code.',
  OAuthSignin: 'Could not start sign-in with that provider.',
  OAuthCallback: 'Sign-in with that provider failed. Please try again.',
  OAuthAccountNotLinked: 'That email is already registered with a different sign-in method.',
  AccessDenied: 'Sign-in was refused. The provider email must be verified and the account must be active.',
  Configuration: 'Sign-in is not configured correctly on the server.',
}
export function authMessage(code?: string): string {
  return (code && AUTH_MESSAGES[code]) || AUTH_MESSAGES.CredentialsSignin
}

export const useBuilder = create<BuilderState>((set, get) => ({
  view: 'landing',
  session: null,
  authReady: false,
  authOpen: false,
  authMode: 'register',
  authLoading: false,
  authError: null,
  twoFactorRequired: false,
  twoFactorEmail: '',
  twoFactorPassword: '',
  authNotice: null,
  unverifiedEmail: null,
  resetToken: null,
  onboardingRequired: false,
  onboardingStep: 'welcome',
  projects: [],
  projectsLoading: false,
  currentProject: null,
  files: [],
  generations: [],
  selectedFilePath: null,
  builderTab: 'code',
  providers: [],
  integrations: [],
  activeProviderKey: null,
  generating: false,
  generatingError: null,
  chatMode: 'auto',
  chatStreaming: false,
  bootError: null,
  booted: false,
  sharedProject: null,

  async boot() {
    set({ bootError: null })
    try {
      const session = await api.getSession()
      set({ session, authReady: true })
      if (session) {
        // Admin redirect on boot.
        set({ view: session.user.isAdmin ? 'admin' : 'chat', projectsLoading: true })
        try {
          await get().refreshProjects()
          await get().refreshProviders()
          await get().refreshIntegrations()
        } finally {
          set({ projectsLoading: false })
        }
        // Check onboarding for non-admin users.
        if (!session.user.isAdmin) await get().checkOnboarding()
      } else {
        set({ view: 'landing' })
        // Best-effort: load providers + integrations but don't crash if Supabase isn't configured.
        Promise.allSettled([get().refreshProviders(), get().refreshIntegrations()]).catch(() => {})
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'boot_failed'
      // If it's a Supabase error, still show the landing page (not the error screen).
      if (message.includes('Supabase') || message.includes('not configured')) {
        set({ bootError: null, authReady: true, view: 'landing' })
      } else {
        set({ bootError: message, authReady: true })
      }
    } finally {
      set({ booted: true })
    }
  },

  async refreshProjects() {
    const projects = await api.listProjects()
    set({ projects })
  },

  openLanding() {
    set({ view: 'landing', currentProject: null, files: [], generations: [] })
  },

  openDashboard() {
    if (!get().session) {
      get().openAuth('login')
      return
    }
    // The chat is the home screen; there is no separate dashboard page.
    set({ view: 'chat', currentProject: null, files: [], generations: [] })
  },

  openChat() {
    if (!get().session) {
      get().openAuth('login')
      return
    }
    set({ view: 'chat', currentProject: null, files: [], generations: [] })
  },

  openAuth(mode) {
    set({ authOpen: true, authMode: mode, authError: null, authNotice: null, unverifiedEmail: null })
  },

  closeAuth() {
    set({ authOpen: false, authError: null, authNotice: null, unverifiedEmail: null, resetToken: null, twoFactorRequired: false, twoFactorEmail: '', twoFactorPassword: '' })
  },

  setAuthMode(mode) {
    set({ authMode: mode, authError: null, authNotice: null, unverifiedEmail: null, twoFactorRequired: false, twoFactorEmail: '', twoFactorPassword: '' })
  },

  // Opens the dialog with a message, e.g. when an OAuth redirect comes back with an error.
  showAuthError(message) {
    set({ authOpen: true, authMode: 'login', authError: message, authNotice: null })
  },

  async register(input) {
    set({ authLoading: true, authError: null })
    try {
      await api.register(input)
      // Registration never establishes a session. The user must follow the
      // single-use verification link before credentials sign-in can succeed.
      set({ authMode: 'login', authOpen: true, authError: null })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'register_failed'
      set({ authError: message })
      return false
    } finally {
      set({ authLoading: false })
    }
  },

  async login(email, password) {
    set({ authLoading: true, authError: null, authNotice: null, unverifiedEmail: null, twoFactorRequired: false })
    try {
      // Step 1: verify the password and learn whether 2FA is needed, or why the
      // account cannot sign in yet (these are reported only after the password is right).
      const checkRes = await fetch('/api/auth/2fa/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
      if (!checkRes.ok) {
        const data = (await checkRes.json().catch(() => ({}))) as { error?: string }
        if (checkRes.status === 429) set({ authError: AUTH_MESSAGES.RateLimited })
        else if (data.error === 'email_not_verified') set({ authError: AUTH_MESSAGES.EmailNotVerified, unverifiedEmail: email })
        else if (data.error === 'account_disabled') set({ authError: AUTH_MESSAGES.AccountDisabled })
        else if (checkRes.status >= 500) set({ authError: 'Sign-in is temporarily unavailable. Please try again.' })
        else set({ authError: AUTH_MESSAGES.CredentialsSignin })
        return false
      }
      const check = (await checkRes.json()) as { requires2fa?: boolean }
      if (check.requires2fa) {
        set({ twoFactorRequired: true, twoFactorEmail: email, twoFactorPassword: password, authLoading: false })
        return false
      }
      // Step 2: no 2FA → proceed with sign-in.
      const result = await api.signIn({ email, password })
      if (!result.ok) {
        set({ authError: authMessage(result.error), unverifiedEmail: result.error === 'EmailNotVerified' ? email : null })
        return false
      }
      return await get().finishLogin()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'login_failed'
      set({ authError: message })
      return false
    } finally {
      set({ authLoading: false })
    }
  },

  async finishLogin(): Promise<boolean> {
    const session = await api.getSession()
    // Admin redirect: admin → admin view, regular → dashboard (or onboarding)
    if (session?.user.isAdmin) {
      set({ session, authOpen: false, authError: null, view: 'admin', currentProject: null, files: [], generations: [] })
    } else {
      set({ session, authOpen: false, authError: null, view: 'chat', twoFactorRequired: false, twoFactorEmail: '', twoFactorPassword: '', currentProject: null, files: [], generations: [] })
    }
    set({ projectsLoading: true })
    try { await get().refreshProjects(); await get().refreshProviders(); await get().refreshIntegrations() }
    finally { set({ projectsLoading: false }) }
    // Check onboarding for non-admin users.
    if (session && !session.user.isAdmin) await get().checkOnboarding()
    return true
  },

  async logout() {
    try {
      await api.signOut()
    } catch {
      /* ignore network errors */
    }
    set({
      session: null,
      view: 'landing',
      projects: [],
      currentProject: null,
      files: [],
      generations: [],
      selectedFilePath: null,
    })
  },

  async openBuilder(projectId) {
    set({ view: 'builder', projectsLoading: true })
    try {
      const detail = await api.getProject(projectId)
      // If the project has generated files (preview-ready or has files),
      // auto-switch to the PREVIEW tab so the user sees their app immediately.
      const hasFiles = detail.files.length > 0
      const isPreviewReady = detail.project.status === 'preview-ready' || detail.project.status === 'deployed'
      set({
        currentProject: detail.project,
        files: detail.files,
        generations: detail.generations,
        selectedFilePath: detail.files[0]?.path ?? null,
        // Auto-open preview if files exist — user wants to SEE the app, not code.
        builderTab: (hasFiles || isPreviewReady) ? 'preview' : 'code',
        activeProviderKey: null,
      })
    } finally {
      set({ projectsLoading: false })
    }
  },

  async openSettings() {
    if (!get().session) {
      get().openAuth('login')
      return
    }
    set({ view: 'settings' })
  },

  async openBusiness() {
    if (!get().session) {
      get().openAuth('login')
      return
    }
    set({ view: 'business' })
  },

  async openJobs() {
    if (!get().session) {
      get().openAuth('login')
      return
    }
    set({ view: 'jobs' })
  },

  async openGodMode() {
    if (!get().session) {
      get().openAuth('login')
      return
    }
    set({ view: 'godmode' })
  },

  openBilling() {
    if (!get().session) { get().openAuth('login'); return }
    set({ view: 'billing' })
  },

  async openMarketing() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'marketing' }) },
  async openSupport() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'support' }) },
  async openOps() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'ops' }) },
  async openNotifications() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'notifications' }) },
  async openAnalytics() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'analytics' }) },
  async openApiKeys() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'api-keys' }) },
  async openWebhooks() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'webhooks' }) },
  async openWorkspaces() { if (!get().session) { get().openAuth('login'); return }; set({ view: 'workspaces' }) },
  openAdmin() {
    const session = get().session
    if (!session) { get().openAuth('login'); return }
    if (session.user.isAdmin) set({ view: 'admin' }); else set({ view: 'chat' })
  },
  openOnboarding() { set({ view: 'onboarding' }) },

  async completeTwoFactor(code) {
    const { twoFactorEmail: email, twoFactorPassword: password } = get()
    if (!email || !password) return false
    set({ authLoading: true, authError: null })
    try {
      const result = await api.signIn({ email, password, totpCode: code.trim() })
      if (!result.ok) {
        // Stay on the code step so a mistyped code can be retried.
        set({ authError: authMessage(result.error === 'CredentialsSignin' ? 'InvalidTotp' : result.error) })
        return false
      }
      set({ twoFactorRequired: false, twoFactorEmail: '', twoFactorPassword: '' })
      await get().finishLogin()
      return true
    } catch { set({ authError: 'Login failed. Please try again.' }); return false }
    finally { set({ authLoading: false }) }
  },

  cancelTwoFactor() {
    set({ twoFactorRequired: false, twoFactorEmail: '', twoFactorPassword: '', authError: null })
  },
  async forgotPassword(email) {
    set({ authLoading: true, authError: null, authNotice: null })
    try {
      const res = await api.forgotPassword(email)
      set({ authNotice: res.message })
      return true
    } catch (err) {
      set({ authError: err instanceof Error ? err.message : 'Could not send the reset email.' })
      return false
    } finally {
      set({ authLoading: false })
    }
  },

  openReset(token) {
    set({ authOpen: true, authMode: 'reset', resetToken: token, authError: null, authNotice: null })
  },

  async resetPassword(password) {
    const token = get().resetToken
    if (!token) { set({ authError: 'This reset link is missing its token. Request a new one.' }); return false }
    set({ authLoading: true, authError: null, authNotice: null })
    try {
      const res = await api.resetPassword(token, password)
      set({ authMode: 'login', resetToken: null, authNotice: res.message })
      return true
    } catch (err) {
      set({ authError: err instanceof Error ? err.message : 'Could not reset the password.' })
      return false
    } finally {
      set({ authLoading: false })
    }
  },

  async resendVerification() {
    const email = get().unverifiedEmail
    if (!email) return false
    set({ authLoading: true, authError: null, authNotice: null })
    try {
      const res = await api.resendVerification(email)
      set({ authNotice: res.message, unverifiedEmail: null })
      return true
    } catch (err) {
      set({ authError: err instanceof Error ? err.message : 'Could not resend the email.' })
      return false
    } finally {
      set({ authLoading: false })
    }
  },


  async checkOnboarding() {
    try {
      const res = await fetch('/api/onboarding', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (!data.completed) {
        set({ onboardingRequired: true, view: 'onboarding' })
      }
    } catch { /* fail-open */ }
  },

  async completeOnboarding(body) {
    try {
      await fetch('/api/onboarding/complete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    } catch { /* fail-open */ }
    set({ onboardingRequired: false, view: 'chat' })
  },

  async skipOnboarding() {
    try { await fetch('/api/onboarding/skip', { method: 'POST' }) } catch { /* fail-open */ }
    set({ onboardingRequired: false, view: 'chat' })
  },

  async createProject(input) {
    try {
      const { project, error } = await api.createProject(input)
      if (!project) return { project: null, error: error || 'create_failed' }
      await get().refreshProjects()
      await get().openBuilder(project.id)
      return { project }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'create_failed'
      return { project: null, error: message }
    }
  },

  async deleteProject(id) {
    await api.deleteProject(id)
    await get().refreshProjects()
    if (get().currentProject?.id === id) get().openDashboard()
  },

  closeProject() {
    get().openDashboard()
  },

  selectFile(path) {
    set({ selectedFilePath: path })
  },

  setBuilderTab(tab) {
    set({ builderTab: tab })
  },

  setActiveProvider(key) {
    set({ activeProviderKey: key })
  },

  async generate(message) {
    const project = get().currentProject
    if (!project) return
    set({ generating: true, generatingError: null })
    try {
      // optimistic user message
      const userMsgId = `local-${Date.now()}`
      const assistantMsgId = `local-${Date.now()}-a`
      set((s) => ({
        generations: [
          ...s.generations,
          {
            id: userMsgId,
            role: 'user',
            content: message,
            fileOps: [],
            providerId: null,
            tokens: 0,
            durationMs: 0,
            createdAt: new Date().toISOString(),
          },
          // Placeholder assistant message that will be updated live as
          // tokens stream in from the LLM.
          {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            fileOps: [],
            providerId: null,
            tokens: 0,
            durationMs: 0,
            createdAt: new Date().toISOString(),
          },
        ],
      }))

      // ---- Consume the SSE stream ----
      const res = await fetch(`/api/projects/${project.id}/generate-stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, providerKey: get().activeProviderKey }),
      })
      if (!res.ok) {
        let errMsg = `generation_failed (${res.status})`
        try {
          const data = await res.json()
          if (data?.error) errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)
        } catch { /* ignore */ }
        throw new Error(errMsg)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('no_stream_body')

      const decoder = new TextDecoder()
      let buffer = ''
      let streamingContent = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const evt = JSON.parse(data)
            if (evt.type === 'token') {
              // Append token to the streaming assistant message.
              streamingContent += evt.content
              set((s) => ({
                generations: s.generations.map((g) =>
                  g.id === assistantMsgId
                    ? { ...g, content: streamingContent }
                    : g,
                ),
              }))
            } else if (evt.type === 'complete') {
              // Finalize: set the message, fileOps, provider, tokens.
              set((s) => ({
                files: evt.files || s.files,
                generations: s.generations.map((g) =>
                  g.id === assistantMsgId
                    ? {
                        ...g,
                        content: evt.message || streamingContent,
                        fileOps: evt.fileOps || [],
                        providerId: evt.provider?.id || null,
                        tokens: evt.tokens || 0,
                        durationMs: evt.durationMs || 0,
                      }
                    : g,
                ),
                selectedFilePath: evt.fileOps?.[0]?.path ?? s.selectedFilePath,
                builderTab: 'preview' as const,
              }))
            } else if (evt.type === 'error') {
              throw new Error(evt.message || 'stream_error')
            }
          } catch (parseErr) {
            // If it's our own thrown error, re-throw.
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected token') {
              throw parseErr
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'generation_failed'
      set({ generatingError: msg })
    } finally {
      set({ generating: false })
    }
  },

  setChatMode(mode) {
    set({ chatMode: mode })
  },

  stopChat() {
    projectChatAbort?.abort()
  },

  async converse(message) {
    const project = get().currentProject
    if (!project) return

    // Build mode is the original behaviour, untouched.
    // Clear build commands go straight to the builder: no extra "should I
    // build?" model call, which is what made these requests slow.
    if (get().chatMode === 'build' || (get().chatMode === 'auto' && classifyIntent(message) === 'build')) {
      await get().generate(message)
      return
    }

    const stamp = Date.now()
    const userMsgId = `local-${stamp}`
    const assistantMsgId = `local-${stamp}-a`
    const blank = {
      fileOps: [],
      providerId: null,
      tokens: 0,
      durationMs: 0,
      createdAt: new Date().toISOString(),
    }
    set((s) => ({
      generating: true,
      chatStreaming: true,
      generatingError: null,
      generations: [
        ...s.generations,
        { id: userMsgId, role: 'user', content: message, ...blank },
        { id: assistantMsgId, role: 'assistant', content: '', ...blank },
      ],
    }))

    const patchAssistant = (fn: (g: GenerationView) => GenerationView) =>
      set((s) => ({ generations: s.generations.map((g) => (g.id === assistantMsgId ? fn(g) : g)) }))

    const controller = new AbortController()
    projectChatAbort = controller
    let handoff = false
    let failure: string | null = null

    try {
      await streamChat(
        `/api/projects/${project.id}/chat-stream`,
        {
          message,
          providerKey: get().activeProviderKey,
          mode: get().chatMode === 'chat' ? 'chat' : 'auto',
        },
        {
          onThinking: (t) => patchAssistant((g) => ({ ...g, thinking: (g.thinking ?? '') + t })),
          onThinkingEnd: (ms) => patchAssistant((g) => ({ ...g, thinkingMs: ms })),
          onToken: (t) => patchAssistant((g) => ({ ...g, content: g.content + t })),
          onBuild: () => {
            handoff = true
          },
          onDone: (info) =>
            patchAssistant((g) => ({
              ...g,
              providerId: info.provider?.id ?? null,
              tokens: info.tokens,
              durationMs: info.durationMs,
            })),
        },
        controller.signal,
      )
    } catch (err) {
      // Pressing Stop is not an error; keep whatever already streamed.
      if (!controller.signal.aborted) failure = err instanceof Error ? err.message : 'chat_failed'
    } finally {
      if (projectChatAbort === controller) projectChatAbort = null
    }

    if (handoff) {
      // The AI decided this is a build request. Drop the chat placeholders and
      // run the existing, unchanged build pipeline (which records the turn).
      set((s) => ({
        chatStreaming: false,
        generations: s.generations.filter((g) => g.id !== userMsgId && g.id !== assistantMsgId),
      }))
      await get().generate(message)
      return
    }

    // Remove an empty assistant bubble left behind by an error or an early stop.
    set((s) => ({
      generating: false,
      chatStreaming: false,
      ...(failure ? { generatingError: failure } : {}),
      generations: s.generations.filter(
        (g) => !(g.id === assistantMsgId && !g.content.trim() && !g.thinking),
      ),
    }))
  },

  async saveFile(path, content, language) {
    const project = get().currentProject
    if (!project) return
    const saved = await api.saveFile(project.id, path, content, language)
    set((s) => ({
      files: s.files.map((f) => (f.path === path ? saved : f)),
    }))
  },

  async deleteFile(path) {
    const project = get().currentProject
    if (!project) return
    await api.deleteFile(project.id, path)
    await get().refreshFiles()
    if (get().selectedFilePath === path) set({ selectedFilePath: null })
  },

  async refreshFiles() {
    const project = get().currentProject
    if (!project) return
    const list = await api.listFiles(project.id)
    // We need content too — refetch the full project (cheap for a builder).
    const detail = await api.getProject(project.id)
    set({ files: detail.files })
  },

  async refreshProviders() {
    const providers = await api.listProviders()
    set({ providers })
  },

  async refreshIntegrations() {
    const integrations = await api.listIntegrations()
    set({ integrations })
  },

  async updateProjectIntegrations(integrations) {
    const project = get().currentProject
    if (!project) return
    const updated = await api.updateProject(project.id, { integrations })
    set({ currentProject: updated })
    await get().refreshProjects()
  },
}))
