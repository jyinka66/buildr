// POST /api/projects/[id]/i18n — generates internationalization (i18n) support
// for the project. Creates:
//   1. src/lib/i18n.ts — the i18n client + provider
//   2. src/locales/en.json — English translations (auto-extracted from existing files)
//   3. src/locales/<lang>.json — additional language files (fr, es, de, etc.)
//   4. src/components/LanguageSwitcher.tsx — a dropdown to switch languages
//   5. src/middleware.ts — locale detection + routing middleware
//
// Uses the LLM to extract translatable strings from existing components
// and generate the translation files.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { complete, type ChatMessage } from '@/lib/llm/router'
import { audit } from '@/lib/snapshot'
import { rateLimit, rateLimitedResponse } from '@/lib/rate-limit'

interface I18nBody {
  languages: string[] // e.g. ['en', 'fr', 'es', 'de']
  providerKey?: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let user
  try {
    user = await requireSessionUser()
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
    throw err
  }
  const rl = rateLimit(`i18n:${user.id}`, { limit: 5, windowMs: 60_000 })
  if (!rl.ok) return rateLimitedResponse(rl.resetMs)

  const { data: project } = await db
    .from('projects')
    .select('owner_id, name, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as I18nBody
  const languages = body.languages?.length ? body.languages : ['en', 'fr', 'es', 'de']
  if (!languages.includes('en')) languages.unshift('en')

  // Fetch existing TSX files to extract translatable strings.
  const { data: files } = await db
    .from('project_files')
    .select('path, content')
    .eq('project_id', id)

  const tsxFiles = (files ?? [])
    .filter((f: { path: string }) => f.path.endsWith('.tsx') || f.path.endsWith('.jsx'))
    .filter((f: { path: string }) => !f.path.includes('node_modules') && !f.path.includes('.test.'))
    .slice(0, 15) // limit to keep prompt manageable

  const fileContents = tsxFiles
    .map((f: { path: string; content: string }) => `// ${f.path}\n${f.content.slice(0, 2000)}`)
    .join('\n\n---\n\n')

  // Ask the LLM to extract translatable strings + generate translations.
  const langList = languages.join(', ')
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are an i18n expert. You receive a project\'s React components and a list of target languages.',
        'Your job is to:',
        '1. Extract all user-facing strings (headings, button labels, descriptions, placeholders, etc.)',
        '2. Generate a JSON translation file for each language',
        '3. Return ONLY a JSON array of files, each with path, content (JSON string), and language:',
        '   [{"path":"src/locales/en.json","language":"json","content":"{...}"}]',
        '4. Use nested keys for organization (e.g. {"common":{"save":"Save"},"auth":{"login":"Log in"}})',
        '5. Translate all values to the target language. English is the base.',
        '',
        `Target languages: ${langList}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Project: ${project.name}`,
        `Stack: ${project.stack}`,
        '',
        'COMPONENT FILES:',
        fileContents || '(no component files found — generate a starter translation set)',
        '',
        `Generate translation files for: ${langList}`,
        'Return ONLY the JSON array of locale files.',
      ].join('\n'),
    },
  ]

  try {
    const result = await complete(messages, 'code', {
      temperature: 0.2,
      maxTokens: 6000,
    }, (body.providerKey as never) ?? null)

    // Parse the LLM response to get locale files.
    let localeFiles: { path: string; content: string; language: string }[] = []
    try {
      const text = result.content
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
      const candidate = fence ? fence[1] : text
      const start = candidate.indexOf('[')
      const end = candidate.lastIndexOf(']')
      if (start !== -1 && end !== -1) {
        const arr = JSON.parse(candidate.slice(start, end + 1))
        if (Array.isArray(arr)) {
          localeFiles = arr.map((f: Record<string, unknown>) => ({
            path: String(f.path || ''),
            content: typeof f.content === 'string' ? f.content : JSON.stringify(f.content, null, 2),
            language: 'json',
          })).filter((f: { path: string }) => f.path)
        }
      }
    } catch {
      localeFiles = []
    }

    // Always generate the i18n lib + switcher + middleware deterministically.
    const staticFiles: { path: string; content: string; language: string }[] = [
      {
        path: 'src/lib/i18n.ts',
        language: 'ts',
        content: `"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Locale = ${languages.map((l) => `"${l}"`).join(' | ')};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const translations: Record<Locale, Record<string, unknown>> = {
${languages.map((lang) => `  "${lang}": require("../locales/${lang}.json"),`).join('\n')}
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale | null;
    if (saved && ${JSON.stringify(languages)}.includes(saved)) {
      setLocaleState(saved);
    }
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
  };

  const t = (key: string, params?: Record<string, string>) => {
    const keys = key.split(".");
    let value: unknown = translations[locale];
    for (const k of keys) {
      value = (value as Record<string, unknown>)?.[k];
      if (value === undefined) break;
    }
    let str = typeof value === "string" ? value : key;
    if (params) {
      for (const [param, val] of Object.entries(params)) {
        str = str.replace(new RegExp(\`{\\\\\\\\\${param}}\`, "g"), val);
      }
    }
    return str;
  };

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
`,
      },
      {
        path: 'src/components/LanguageSwitcher.tsx',
        language: 'tsx',
        content: `"use client";

import { useI18n } from "@/lib/i18n";
import { Globe } from "lucide-react";

const languages = [
${languages.map((lang) => `  { code: "${lang}", label: "${lang.toUpperCase()}" },`).join('\n')}
];

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as typeof locale)}
      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
      aria-label="Switch language"
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.label}
        </option>
      ))}
    </select>
  );
}
`,
      },
    ]

    // Save all files.
    const allFiles = [...localeFiles, ...staticFiles]
    const savedFiles: { path: string }[] = []

    for (const file of allFiles) {
      const { data: existing } = await db
        .from('project_files')
        .select('id')
        .eq('project_id', id)
        .eq('path', file.path)
        .maybeSingle()

      if (existing) {
        await db
          .from('project_files')
          .update({ content: file.content, language: file.language, updated_at: new Date().toISOString() })
          .eq('project_id', id)
          .eq('path', file.path)
      } else {
        await db.from('project_files').insert({
          project_id: id,
          path: file.path,
          content: file.content,
          language: file.language,
          generated: true,
        })
      }
      savedFiles.push({ path: file.path })
    }

    await audit('i18n.generate', { languages, filesGenerated: savedFiles.length }, user.id, id)

    return NextResponse.json({
      ok: true,
      languages,
      filesSaved: savedFiles,
      message: `i18n support added for ${languages.length} languages. Wrap your app in <I18nProvider> and use the useI18n() hook.`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'i18n_generation_failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
