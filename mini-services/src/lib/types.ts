// Shared types for the Buildr platform.
// These mirror the Prisma models and add derived/view shapes used across
// the API and the UI. Keep this side-effect free (no imports beyond types).

export type StackKey = 'nextjs' | 'node-express' | 'react-vite' | 'static-html'
export type StylingKey = 'tailwind' | 'bootstrap' | 'plain'
export type ProviderKey =
  | 'zai'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'ollama'

export type TaskKind = 'code' | 'schema' | 'docs' | 'general'

export interface ProviderConfig {
  id: string
  key: ProviderKey
  name: string
  model: string
  apiKey: string
  baseUrl?: string | null
  enabled: boolean
  weight: number
  speciality: TaskKind
  health: 'healthy' | 'degraded' | 'down'
  lastChecked?: string | null
}

export interface DbConfig {
  engine: 'sqlite' | 'postgres' | 'mysql' | 'supabase' | 'none'
  orm: 'prisma' | 'drizzle' | 'typeorm' | 'none'
  supabaseUrl?: string
  supabaseAnonKey?: string
}

export interface ProjectView {
  id: string
  name: string
  slug: string
  description: string
  stack: StackKey
  styling: StylingKey
  prompt: string
  providerId: string | null
  integrations: string[]
  dbConfig: DbConfig
  status: 'draft' | 'preview-ready' | 'deployed' | 'error'
  previewUrl: string | null
  deploymentUrl: string | null
  fileCount: number
  createdAt: string
  updatedAt: string
}

export interface FileView {
  id: string
  path: string
  content: string
  language: string
  generated: boolean
  updatedAt: string
}

export interface GenerationView {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  fileOps: FileOp[]
  providerId: string | null
  tokens: number
  durationMs: number
  createdAt: string
}

export interface FileOp {
  path: string
  action: 'create' | 'update' | 'delete'
  language?: string
}

export interface IntegrationDef {
  key: string
  name: string
  description: string
  category: 'payments' | 'auth' | 'communication' | 'database' | 'identity' | 'fintech'
  icon: string
  envVars: string[]
  enabled: boolean
}

export interface GenerationResult {
  message: string
  fileOps: FileOp[]
  files: { path: string; content: string; language: string }[]
  provider: ProviderConfig
  tokens: number
  durationMs: number
}

export interface DeploymentView {
  id: string
  projectId: string
  environment: 'preview' | 'production' | 'github'
  status: 'queued' | 'building' | 'success' | 'failed' | 'cancelled'
  url: string | null
  repo: string | null
  branch: string | null
  commitSha: string | null
  logs: string
  createdAt: string
  updatedAt: string
}
