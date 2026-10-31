// Typed API client used by all UI components. Wraps fetch with JSON helpers.
// All endpoints are relative paths (gateway-aware). No absolute URLs.

import { signIn as nextAuthSignIn } from 'next-auth/react'
import type {
  FileView,
  GenerationView,
  GenerationResult,
  IntegrationDef,
  ProjectView,
  ProviderConfig,
} from '@/lib/types'

export interface SessionInfo {
  user: { id?: string; email?: string | null; name?: string | null; isAdmin?: boolean }
}

export interface ProjectDetail {
  project: ProjectView
  files: FileView[]
  generations: GenerationView[]
}

export interface CreateProjectInput {
  name: string
  prompt: string
  stack: string
  styling: string
  integrations: string[]
  dbConfig: {
    engine: string
    orm: string
    supabaseUrl?: string
    supabaseAnonKey?: string
  }
  providerKey?: string | null
  generate?: boolean
}

async function json<T>(res: Response): Promise<T> {
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
  return res.json() as Promise<T>
}

export const api = {
  async listProjects(): Promise<ProjectView[]> {
    const res = await fetch('/api/projects', { cache: 'no-store' })
    const data = await json<{ projects: ProjectView[] }>(res)
    return data.projects
  },

  async getProject(id: string): Promise<ProjectDetail> {
    const res = await fetch(`/api/projects/${id}`, { cache: 'no-store' })
    return json<ProjectDetail>(res)
  },

  async createProject(input: CreateProjectInput): Promise<{ project: ProjectView; generation?: GenerationResult; error?: string }> {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    return json(res)
  },

  async setProjectPublic(id: string, enable: boolean): Promise<{ isPublic: boolean; shareSlug: string | null; shareUrl: string | null }> {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enable }),
    })
    return json(res)
  },

  async deleteProject(id: string): Promise<void> {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
  },

  async updateProject(id: string, patch: {
    name?: string
    description?: string
    integrations?: string[]
    dbConfig?: Record<string, unknown>
    providerKey?: string | null
  }): Promise<ProjectView> {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await json<{ project: ProjectView }>(res)
    return data.project
  },

  async listFiles(id: string): Promise<{ path: string; id: string; language: string; generated: boolean; updatedAt: string }[]> {
    const res = await fetch(`/api/projects/${id}/files`, { cache: 'no-store' })
    const data = await json<{ files: { path: string; id: string; language: string; generated: boolean; updatedAt: string }[] }>(res)
    return data.files
  },

  async getFile(id: string, path: string): Promise<FileView> {
    const res = await fetch(`/api/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' })
    const data = await json<{ file: FileView }>(res)
    return data.file
  },

  async saveFile(id: string, path: string, content: string, language?: string): Promise<FileView> {
    const res = await fetch(`/api/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, language }),
    })
    const data = await json<{ file: FileView }>(res)
    return data.file
  },

  async deleteFile(id: string, path: string): Promise<void> {
    await fetch(`/api/projects/${id}/files/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'DELETE',
    })
  },

  async generate(id: string, message: string, providerKey?: string | null): Promise<{
    generation: GenerationResult
    files: FileView[]
  }> {
    const res = await fetch(`/api/projects/${id}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, providerKey }),
    })
    return json(res)
  },

  async listProviders(): Promise<(ProviderConfig & { hasKey: boolean })[]> {
    const res = await fetch('/api/providers', { cache: 'no-store' })
    const data = await json<{ providers: (ProviderConfig & { hasKey: boolean })[] }>(res)
    return data.providers
  },

  async updateProvider(body: {
    key: string
    apiKey?: string
    enabled?: boolean
    weight?: number
    model?: string
    baseUrl?: string
    speciality?: string
  }): Promise<ProviderConfig[]> {
    const res = await fetch('/api/providers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await json<{ providers: ProviderConfig[] }>(res)
    return data.providers
  },

  async listIntegrations(): Promise<IntegrationDef[]> {
    const res = await fetch('/api/integrations', { cache: 'no-store' })
    const data = await json<{ integrations: IntegrationDef[] }>(res)
    return data.integrations
  },

  async exportZipUrl(id: string): Promise<string> {
    return `/api/export/${id}`
  },

  async deploy(id: string, environment: 'preview' | 'production'): Promise<unknown> {
    const res = await fetch('/api/deploy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: id, environment }),
    })
    return json(res)
  },

  async pushToGitHub(body: {
    projectId: string
    token: string
    repo: string
    branch?: string
    commitMessage?: string
  }): Promise<{ deployment: { pushedFiles: number; repo: string; branch: string; commitSha: string; url: string } }> {
    const res = await fetch('/api/github', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  // ----- Auth -----

  async getSession(): Promise<SessionInfo | null> {
    const res = await fetch('/api/auth/session', { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { session: SessionInfo | null }
    return data.session
  },

  async register(body: {
    email: string
    password: string
    name?: string
  }): Promise<{ user: { id: string; email: string; name: string | null } }> {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  // Credentials sign-in through NextAuth. On failure NextAuth answers 401 with
  // { url: ".../?error=<Code>" }; the code is returned as `error` so the UI can
  // react precisely (EmailNotVerified, InvalidTotp, RateLimited, ...).
  async signIn(body: { email: string; password: string; totpCode?: string }): Promise<{ ok: boolean; error?: string }> {
    const params = new URLSearchParams({
      email: body.email,
      password: body.password,
      csrfToken: await getCsrfToken(),
      json: 'true',
    })
    if (body.totpCode) params.set('totpCode', body.totpCode)
    const res = await fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params,
    })
    let code: string | undefined
    try {
      const data = (await res.json()) as { url?: string }
      if (data.url) code = new URL(data.url, window.location.origin).searchParams.get('error') ?? undefined
    } catch {
      /* non-JSON body */
    }
    if (!res.ok || code) return { ok: false, error: code ?? 'CredentialsSignin' }
    return { ok: true }
  },

  // Names of the OAuth providers the server has credentials for.
  async getOAuthProviders(): Promise<('google' | 'github')[]> {
    try {
      const res = await fetch('/api/auth/providers', { cache: 'no-store' })
      if (!res.ok) return []
      const data = (await res.json()) as Record<string, { id: string; type: string }> | null
      return Object.values(data ?? {})
        .filter((p) => p.type === 'oauth' && (p.id === 'google' || p.id === 'github'))
        .map((p) => p.id as 'google' | 'github')
    } catch {
      return []
    }
  },

  // NextAuth v4 only starts an OAuth flow from a CSRF-protected POST; a plain GET to
  // /api/auth/signin/<provider> just redirects back to the sign-in page.
  signInWithProvider(provider: 'google' | 'github'): void {
    const callbackUrl = typeof window !== 'undefined' ? window.location.origin : '/'
    void nextAuthSignIn(provider, { callbackUrl })
  },

  async forgotPassword(email: string): Promise<{ message: string }> {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return json(res)
  },

  async resetPassword(token: string, password: string): Promise<{ message: string }> {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
    return json(res)
  },

  async resendVerification(email: string): Promise<{ message: string }> {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    return json(res)
  },

  // ----- Two-factor authentication (settings) -----

  async twoFactorStatus(): Promise<{ enabled: boolean }> {
    return json(await fetch('/api/auth/2fa/enable', { cache: 'no-store' }))
  },

  async twoFactorBegin(): Promise<{ secret: string; otpauthUrl: string; manualKey: string }> {
    return json(await fetch('/api/auth/2fa/enable', { method: 'POST' }))
  },

  async twoFactorConfirm(code: string): Promise<{ backupCodes: string[] }> {
    const res = await fetch('/api/auth/2fa/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    return json(res)
  },

  async twoFactorDisable(body: { code?: string; password?: string }): Promise<{ ok: boolean }> {
    const res = await fetch('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  async updateProfileName(name: string): Promise<{ ok: boolean; name: string }> {
    const res = await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return json(res)
  },

  async changePassword(body: {
    currentPassword: string
    newPassword: string
    totpCode?: string
  }): Promise<{ ok: boolean }> {
    const res = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  async deleteAccount(body: { password: string; totpCode?: string; confirm: string }): Promise<{ ok: boolean }> {
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  async signOut(): Promise<void> {
    const csrfToken = await getCsrfToken()
    await fetch('/api/auth/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrfToken, json: 'true' }),
    })
  },

  // ----- Business Launch (AI Co-Founder) -----

  async launchBusiness(body: { idea: string; providerKey?: string | null }): Promise<{
    ok: boolean
    business: Record<string, unknown>
    projectId: string
    fileCount: number
    logoPath: string | null
    message: string
  }> {
    const res = await fetch('/api/business/launch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return json(res)
  },

  async listBusinesses(): Promise<{
    businesses: {
      id: string; name: string; slug: string; description: string
      status: string; projectId: string | null; createdAt: string
    }[]
  }> {
    const res = await fetch('/api/business', { cache: 'no-store' })
    return json(res)
  },

  // ----- God Mode (autonomous agent) -----

  // ----- Billing & Subscriptions -----

  async getPlans(): Promise<{
    plans: {
      id: string; name: string; priceMonthly: number; priceYearly: number
      tagline: string; features: string[]; highlighted: boolean; cta: string
      limits: Record<string, number>
    }[]
  }> {
    const res = await fetch('/api/billing/plan', { cache: 'no-store' })
    return json(res)
  },

  async getMySubscription(): Promise<{ subscription: { planId: string } }> {
    const res = await fetch('/api/billing/plan?which=mine', { cache: 'no-store' })
    return json(res)
  },

  async getMyUsage(): Promise<{
    plan: {
      id: string; name: string; priceMonthly: number
      tagline: string; features: string[]; highlighted?: boolean; cta: string
    }
    usage: Record<string, { used: number; limit: number; unlimited: boolean }>
  }> {
    const res = await fetch('/api/billing/usage', { cache: 'no-store' })
    return json(res)
  },

  async upgradePlan(planId: string): Promise<{
    ok: boolean
    subscription: { planId: string; status: string }
    plan: { id: string; name: string; priceMonthly: number; features: string[]; limits: Record<string, number> }
  }> {
    const res = await fetch('/api/billing/upgrade', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planId }),
    })
    return json(res)
  },

  // ----- Notifications -----
  async listNotifications(opts?: { unread?: boolean; source?: string; limit?: number }): Promise<{ notifications: { id: string; source: string; severity: string; title: string; message: string; readAt: string | null; createdAt: string }[] }> {
    const params = new URLSearchParams()
    if (opts?.unread) params.set('unread', 'true')
    if (opts?.source) params.set('source', opts.source)
    if (opts?.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    const res = await fetch(`/api/notifications${qs ? '?' + qs : ''}`, { cache: 'no-store' })
    return json(res)
  },
  async getUnreadCount(): Promise<{ unread: number }> {
    const res = await fetch('/api/notifications/unread-count', { cache: 'no-store' })
    return json(res)
  },
  async markNotificationRead(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/notifications/${id}/read`, { method: 'POST' })
    return json(res)
  },
  async markAllNotificationsRead(): Promise<{ ok: boolean }> {
    const res = await fetch('/api/notifications/read-all', { method: 'POST' })
    return json(res)
  },

  // ----- Jobs -----
  async listJobs(): Promise<{ jobs: { id: string; title: string; description: string; jobType: string; clientName: string | null; status: string; budget: number | null; createdAt: string }[] }> {
    const res = await fetch('/api/jobs', { cache: 'no-store' })
    return json(res)
  },
  async createJob(body: { title: string; description: string; jobType?: string; clientName?: string; clientEmail?: string; budget?: number; deadline?: string }): Promise<{ ok: boolean; job: Record<string, unknown> }> {
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async executeJob(jobId: string): Promise<{ ok: boolean; jobId: string; projectId: string; status: string; fileCount: number; message: string }> {
    const res = await fetch(`/api/jobs/${jobId}/execute`, { method: 'POST' })
    return json(res)
  },

  // ----- Project tools (stub methods for dialog components) -----
  async testApi(projectId: string, body: { method: string; path: string; headers?: Record<string, string>; body?: unknown }): Promise<{ ok: boolean; status: number; data: unknown; durationMs: number }> {
    const res = await fetch(`/api/projects/${projectId}/api-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async createBranchPR(projectId: string, body: { branch: string; title: string; body: string }): Promise<{ ok: boolean; url: string }> {
    const res = await fetch(`/api/projects/${projectId}/branches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async searchFiles(projectId: string, query: string): Promise<{ results: { path: string; line: number; content: string }[] }> {
    const res = await fetch(`/api/projects/${projectId}/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
    return json(res)
  },
  async listCustomIntegrations(projectId: string): Promise<{ integrations: { id: string; key: string; name: string; config: Record<string, unknown> }[] }> {
    const res = await fetch(`/api/projects/${projectId}/custom-integrations`, { cache: 'no-store' })
    return json(res)
  },
  async upsertCustomIntegration(projectId: string, body: { key: string; name: string; config: Record<string, unknown> }): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/custom-integrations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async deleteCustomIntegration(projectId: string, key: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/custom-integrations?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    return json(res)
  },
  async getDbTables(projectId: string): Promise<{ tables: { name: string; columns: { name: string; type: string }[] }[] }> {
    const res = await fetch(`/api/projects/${projectId}/db-tables`, { cache: 'no-store' })
    return json(res)
  },
  async dbQuery(projectId: string, sql: string): Promise<{ rows: Record<string, unknown>[]; error?: string }> {
    const res = await fetch(`/api/projects/${projectId}/db-query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql }) })
    return json(res)
  },
  async listEnvironments(projectId: string): Promise<{ environments: { id: string; name: string; config: Record<string, unknown> }[] }> {
    const res = await fetch(`/api/projects/${projectId}/environments`, { cache: 'no-store' })
    return json(res)
  },
  async upsertEnvVar(projectId: string, body: { environment: string; key: string; value: string }): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/environments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async deleteEnvVar(projectId: string, environment: string, key: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/environments?env=${environment}&key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    return json(res)
  },
  async generateImage(projectId: string, body: { prompt: string; size?: string }): Promise<{ ok: boolean; imagePath: string }> {
    const res = await fetch(`/api/projects/${projectId}/generate-image`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async importFromGitHub(repo: string): Promise<{ ok: boolean; files: { path: string; content: string }[] }> {
    const res = await fetch('/api/import/github', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ repo }) })
    return json(res)
  },
  async refactor(projectId: string, body: { instruction: string; scope?: string }): Promise<{ ok: boolean; changes: { path: string; oldContent: string; newContent: string }[] }> {
    const res = await fetch(`/api/projects/${projectId}/refactor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async generateSchema(projectId: string, body: { description: string; engine: string }): Promise<{ ok: boolean; sql: string; tables: string[] }> {
    const res = await fetch(`/api/projects/${projectId}/schema-design`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async listSecrets(projectId: string): Promise<{ secrets: { id: string; key: string; value: string }[] }> {
    const res = await fetch(`/api/projects/${projectId}/secrets`, { cache: 'no-store' })
    return json(res)
  },
  async upsertSecret(projectId: string, body: { key: string; value: string }): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/secrets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async deleteSecret(projectId: string, key: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/secrets?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    return json(res)
  },
  async listSnippets(): Promise<{ snippets: { id: string; title: string; description: string; code: string; language: string }[] }> {
    const res = await fetch('/api/snippets', { cache: 'no-store' })
    return json(res)
  },
  async saveSnippet(body: { title: string; description: string; code: string; language: string }): Promise<{ ok: boolean; id: string }> {
    const res = await fetch('/api/snippets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async deleteSnippet(id: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/snippets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    return json(res)
  },
  async listMembers(projectId: string): Promise<{ members: { id: string; userId: string; role: string; email: string; name: string | null }[] }> {
    const res = await fetch(`/api/projects/${projectId}/members`, { cache: 'no-store' })
    return json(res)
  },
  async inviteMember(projectId: string, body: { email: string; role: string }): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/members`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async removeMember(projectId: string, memberId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/projects/${projectId}/members?id=${encodeURIComponent(memberId)}`, { method: 'DELETE' })
    return json(res)
  },
  async testWebhook(projectId: string, body: { url: string; method: string; headers?: Record<string, string>; body?: unknown }): Promise<{ ok: boolean; status: number; response: string; durationMs: number }> {
    const res = await fetch(`/api/projects/${projectId}/webhook-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // ----- Phase 1 Expansions -----

  // Business Launch: Financial projections + business plan
  async generateBusinessPlan(businessId: string): Promise<{ ok: boolean; plan: Record<string, unknown> }> {
    const res = await fetch(`/api/business/${businessId}/plan-export`, { method: 'POST' })
    return json(res)
  },

  // Freelance Jobs: Client portal
  async getClientPortal(jobId: string, token: string): Promise<{ job: Record<string, unknown>; scope: Record<string, unknown>; tasks: Record<string, unknown>[]; deliverables: Record<string, unknown>[]; projectId: string | null }> {
    const res = await fetch(`/api/jobs/${jobId}/client-portal?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    return json(res)
  },

  // Freelance Jobs: Contract generation
  async generateContract(jobId: string, body: { hourlyRate?: number; paymentTerms?: string }): Promise<{ ok: boolean; contract: string; estimatedCost: number; hourlyRate: number; paymentTerms: string }> {
    const res = await fetch(`/api/jobs/${jobId}/contract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // Freelance Jobs: Invoice generation
  async generateInvoice(jobId: string, body: { hourlyRate?: number; taxRate?: number }): Promise<{ ok: boolean; invoice: Record<string, unknown> }> {
    const res = await fetch(`/api/jobs/${jobId}/invoice`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // Marketing: Ad creatives with image generation
  async generateAdCreatives(body: { businessId?: string; projectId?: string; description?: string; platform: string }): Promise<{ ok: boolean; platform: string; variants: Record<string, unknown>[]; targeting: Record<string, unknown>; imageBase64: string | null; imagePrompt: string }> {
    const res = await fetch('/api/marketing/ad-creatives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // ----- Phase 2 Expansions -----

  // Business Launch: Pitch deck
  async generatePitchDeck(businessId: string): Promise<{ ok: boolean; deck: Record<string, unknown> }> {
    const res = await fetch(`/api/business/${businessId}/pitch-deck`, { method: 'POST' })
    return json(res)
  },

  // Freelance Jobs: Milestones
  async getMilestones(jobId: string): Promise<{ milestones: { number: number; name: string; tasks: Record<string, unknown>[]; status: string; paymentPercentage: number }[] }> {
    const res = await fetch(`/api/jobs/${jobId}/milestones`, { cache: 'no-store' })
    return json(res)
  },
  async updateMilestone(jobId: string, body: { milestoneIndex: number; action: 'approve' | 'reject'; feedback?: string }): Promise<{ ok: boolean; action: string; milestoneIndex: number }> {
    const res = await fetch(`/api/jobs/${jobId}/milestones`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // Freelance Jobs: Paystack payments
  async createJobPayment(jobId: string, body: { type: 'deposit' | 'milestone' | 'final'; amountKobo: number; milestoneIndex?: number }): Promise<{ ok: boolean; authorizationUrl: string; reference: string; paymentId: string }> {
    const res = await fetch(`/api/jobs/${jobId}/payment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async verifyJobPayment(jobId: string, reference: string): Promise<{ ok: boolean; status: string; amount: number; paidAt: string | null; cached?: boolean }> {
    const res = await fetch(`/api/jobs/${jobId}/payment/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reference }) })
    return json(res)
  },
  async listJobPayments(jobId: string): Promise<{ payments: { id: string; reference: string; amountKobo: number; currency: string; status: string; type: string; milestoneIndex: number | null; customerEmail: string | null; authorizationUrl: string | null; paidAt: string | null; createdAt: string }[] }> {
    const res = await fetch(`/api/jobs/${jobId}/payments`, { cache: 'no-store' })
    return json(res)
  },

  // Marketing: Email automation flows
  async generateEmailFlow(body: { type: 'welcome' | 'abandoned_cart' | 'reengagement'; businessId?: string; description?: string }): Promise<{ ok: boolean; type: string; flowName: string; flow: Record<string, unknown> }> {
    const res = await fetch('/api/marketing/email-flows', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // ----- Phase 3 Expansions -----

  // Business Launch: Go-to-market strategy
  async generateGtmStrategy(businessId: string): Promise<{ ok: boolean; gtm: Record<string, unknown> }> {
    const res = await fetch(`/api/business/${businessId}/go-to-market`, { method: 'POST' })
    return json(res)
  },

  // Freelance Jobs: Portfolio
  async getPortfolio(jobId: string): Promise<{ portfolio: Record<string, unknown> }> {
    const res = await fetch(`/api/jobs/${jobId}/portfolio`, { cache: 'no-store' })
    return json(res)
  },
  async submitReview(jobId: string, body: { rating: number; review: string; clientName?: string }): Promise<{ ok: boolean; review: Record<string, unknown> }> {
    const res = await fetch(`/api/jobs/${jobId}/portfolio`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },

  // Marketing: Analytics
  async getMarketingAnalytics(): Promise<{ totalCampaigns: number; byType: Record<string, number>; byPlatform: Record<string, number>; byStatus: Record<string, number>; recent: Record<string, unknown>[]; suggestions: string[] }> {
    const res = await fetch('/api/marketing/analytics', { cache: 'no-store' })
    return json(res)
  },

  // ----- Leads (Lead-to-Job Pipeline) -----

  async listLeads(params?: { status?: string; source?: string }): Promise<{ leads: LeadRecord[] }> {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.source) qs.set('source', params.source)
    const q = qs.toString()
    const res = await fetch(`/api/leads${q ? `?${q}` : ''}`, { cache: 'no-store' })
    return json(res)
  },
  async getLead(leadId: string): Promise<{ lead: LeadRecord }> {
    const res = await fetch(`/api/leads/${leadId}`, { cache: 'no-store' })
    return json(res)
  },
  async createLead(body: LeadCreateInput): Promise<{ ok: boolean; lead?: LeadRecord }> {
    const res = await fetch('/api/leads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async updateLead(leadId: string, body: LeadUpdateInput): Promise<{ ok: boolean; lead: LeadRecord }> {
    const res = await fetch(`/api/leads/${leadId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
  async deleteLead(leadId: string): Promise<{ ok: boolean }> {
    const res = await fetch(`/api/leads/${leadId}`, { method: 'DELETE' })
    return json(res)
  },
  async convertLead(leadId: string, body?: { jobType?: string; title?: string }): Promise<{ ok: boolean; jobId: string; lead?: LeadRecord; alreadyConverted?: boolean }> {
    const res = await fetch(`/api/leads/${leadId}/convert`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    return json(res)
  },
  async addLeadNote(leadId: string, text: string): Promise<{ ok: boolean; note: LeadNote }> {
    const res = await fetch(`/api/leads/${leadId}/notes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    return json(res)
  },
  async captureLead(body: LeadCaptureInput): Promise<{ ok: boolean; leadId: string }> {
    const res = await fetch('/api/leads/capture', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return json(res)
  },
}

// ---------------------------------------------------------------------------
// Lead types (shared with the UI)
// ---------------------------------------------------------------------------

export interface LeadNote {
  at: string
  text: string
  author: string
}

export interface LeadRecord {
  id: string
  ownerId?: string
  projectId?: string | null
  name: string
  email: string
  phone?: string | null
  company?: string | null
  source: string
  campaignId?: string | null
  trackingId?: string | null
  utmData?: Record<string, unknown>
  requirements?: string | null
  budget?: number | null
  status: string
  convertedJobId?: string | null
  convertedAt?: string | null
  notes: LeadNote[]
  createdAt?: string | null
  updatedAt?: string | null
}

export interface LeadCreateInput {
  name: string
  email: string
  phone?: string
  company?: string
  source?: string
  requirements?: string
  budget?: number
  campaignId?: string
  trackingId?: string
  utmData?: Record<string, unknown>
  projectId?: string
}

export interface LeadUpdateInput {
  status?: string
  notes?: string
  budget?: number
  requirements?: string
}

export interface LeadCaptureInput {
  name: string
  email: string
  phone?: string
  company?: string
  requirements?: string
  projectId: string
  campaignId?: string
  trackingId?: string
  utm?: Record<string, unknown>
}

async function getCsrfToken(): Promise<string> {
  const res = await fetch('/api/auth/csrf', { cache: 'no-store' })
  if (!res.ok) return ''
  const data = (await res.json()) as { csrfToken?: string }
  return data.csrfToken ?? ''
}
