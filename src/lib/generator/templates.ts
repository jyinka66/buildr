// Project scaffold templates (Module 2 support)
// ------------------------------------------------------------------
// Deterministic, runnable scaffolds for each supported stack. These are
// ALWAYS layered under the LLM-generated app code so the exported project
// is structurally complete and bootable.

import type { DbConfig, StackKey, StylingKey } from '@/lib/types'

export interface ScaffoldFile {
  path: string
  content: string
  language: string
}

export interface ScaffoldInput {
  name: string
  stack: StackKey
  styling: StylingKey
  dbConfig: DbConfig
  prompt: string
  integrations: string[]
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'buildr-app'

// ---------------------------------------------------------------------------
// Common files shared across Node stacks.
// ---------------------------------------------------------------------------

function readme(name: string, description: string): ScaffoldFile {
  return {
    path: 'README.md',
    language: 'md',
    content: `# ${name}

${description}

## Getting Started

\`\`\`bash
npm install
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- Prisma ORM

## Environment

Copy \`.env.example\` to \`.env\` and fill in your keys.

## License

MIT
`,
  }
}

function envExample(integrations: string[], dbConfig: DbConfig): ScaffoldFile {
  const lines: string[] = []
  if (dbConfig.engine === 'postgres') {
    lines.push('DATABASE_URL="postgresql://user:password@localhost:5432/app?schema=public"')
  } else if (dbConfig.engine === 'mysql') {
    lines.push('DATABASE_URL="mysql://user:password@localhost:3306/app"')
  } else if (dbConfig.engine === 'supabase') {
    lines.push(
      `DATABASE_URL="postgresql://postgres:password@db.${dbConfig.supabaseUrl || 'your-project'}.supabase.co:5432/postgres"`,
    )
    lines.push(`NEXT_PUBLIC_SUPABASE_URL="https://${dbConfig.supabaseUrl || 'your-project'}.supabase.co"`)
    lines.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY="${dbConfig.supabaseAnonKey || 'your-anon-key'}"`)
  } else {
    lines.push('DATABASE_URL="file:./dev.db"')
  }
  if (integrations.includes('stripe')) {
    lines.push('STRIPE_SECRET_KEY="sk_test_..."')
    lines.push('STRIPE_WEBHOOK_SECRET="whsec_..."')
    lines.push('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."')
  }
  if (integrations.includes('nextauth')) {
    lines.push('NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"')
    lines.push('NEXTAUTH_URL="http://localhost:3000"')
  }
  if (integrations.includes('clerk')) {
    lines.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."')
    lines.push('CLERK_SECRET_KEY="sk_test_..."')
  }
  if (integrations.includes('resend')) lines.push('RESEND_API_KEY="re_..."')
  if (integrations.includes('sendgrid')) lines.push('SENDGRID_API_KEY="SG._..."')
  if (integrations.includes('twilio')) {
    lines.push('TWILIO_ACCOUNT_SID="AC..."')
    lines.push('TWILIO_AUTH_TOKEN="..."')
    lines.push('TWILIO_FROM_NUMBER="+1..."')
  }
  if (integrations.includes('plaid')) {
    lines.push('PLAID_CLIENT_ID="..."')
    lines.push('PLAID_SECRET="..."')
    lines.push('PLAID_ENV="sandbox"')
  }
  if (integrations.includes('paystack')) lines.push('PAYSTACK_SECRET_KEY="sk_test_..."')
  if (integrations.includes('razorpay')) {
    lines.push('RAZORPAY_KEY_ID="rzp_test_..."')
    lines.push('RAZORPAY_KEY_SECRET="..."')
  }
  if (integrations.includes('onfido')) {
    lines.push('ONFIDO_API_TOKEN="..."')
    lines.push('ONFIDO_REGION="us"')
  }
  return {
    path: '.env.example',
    language: 'env',
    content: lines.join('\n') + '\n',
  }
}

function gitignore(stack: StackKey): ScaffoldFile {
  const nodeLines = [
    'node_modules',
    '.next',
    'out',
    'build',
    'dist',
    '.env',
    '.env.local',
    '.env.*.local',
    '*.log',
    '.DS_Store',
    '.vscode',
    '.idea',
    'coverage',
    '.turbo',
  ]
  if (stack === 'react-vite') nodeLines.splice(1, 1)
  return {
    path: '.gitignore',
    language: 'text',
    content: nodeLines.join('\n') + '\n',
  }
}

// ---------------------------------------------------------------------------
// Next.js 16 App Router scaffold.
// ---------------------------------------------------------------------------

function nextjsScaffold(input: ScaffoldInput): ScaffoldFile[] {
  const pkgName = slugify(input.name)
  const isTailwind = input.styling === 'tailwind'

  const packageJson = {
    name: pkgName,
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'next lint',
      ...(input.dbConfig.orm !== 'none'
        ? {
            'db:push': 'prisma db push',
            'db:generate': 'prisma generate',
            'db:migrate': 'prisma migrate dev',
          }
        : {}),
    },
    dependencies: {
      next: '^16.1.1',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      ...(input.dbConfig.orm === 'prisma' ? { '@prisma/client': '^6.11.1' } : {}),
      ...(input.dbConfig.orm === 'drizzle'
        ? { drizzle: '^0.36.0', 'drizzle-orm': '^0.36.0' }
        : {}),
      ...(isTailwind ? { tailwindcss: '^4.0.0', '@tailwindcss/postcss': '^4' } : {}),
    },
    devDependencies: {
      typescript: '^5',
      '@types/node': '^20',
      '@types/react': '^19',
      '@types/react-dom': '^19',
      ...(input.dbConfig.orm === 'prisma' ? { prisma: '^6.11.1' } : {}),
      eslint: '^9',
      'eslint-config-next': '^16.1.1',
    },
  }

  const files: ScaffoldFile[] = [
    {
      path: 'package.json',
      language: 'json',
      content: JSON.stringify(packageJson, null, 2) + '\n',
    },
    {
      path: 'next.config.ts',
      language: 'ts',
      content: `import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
`,
    },
    {
      path: 'tsconfig.json',
      language: 'json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            lib: ['dom', 'dom.iterable', 'esnext'],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: 'esnext',
            moduleResolution: 'bundler',
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: 'preserve',
            incremental: true,
            plugins: [{ name: 'next' }],
            paths: { '@/*': ['./src/*'] },
          },
          include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
          exclude: ['node_modules'],
        },
        null,
        2,
      ) + '\n',
    },
    {
      path: 'next-env.d.ts',
      language: 'ts',
      content: `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`,
    },
    {
      path: 'postcss.config.mjs',
      language: 'js',
      content: isTailwind
        ? `const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
`
        : `const config = { plugins: {} };
export default config;
`,
    },
    ...(isTailwind
      ? [
          {
            path: 'src/app/globals.css',
            language: 'css',
            content: `@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #0a0a0a;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #fafafa;
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: system-ui, -apple-system, sans-serif;
}
`,
          },
        ]
      : []),
    {
      path: 'src/app/layout.tsx',
      language: 'tsx',
      content: `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(input.name)},
  description: ${JSON.stringify(input.prompt.slice(0, 160))},
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>${isTailwind ? ' className="min-h-screen bg-background text-foreground antialiased"' : ''}>
        {children}
      </body>
    </html>
  );
}
`,
    },
    {
      path: 'src/app/page.tsx',
      language: 'tsx',
      content: `export default function Home() {
  return (
    <main${isTailwind ? ' className="flex min-h-screen flex-col items-center justify-center p-24"' : ''}>
      <div${isTailwind ? ' className="text-center"' : ' style={{ textAlign: "center" }}'}>
        <h1${isTailwind ? ' className="text-4xl font-bold mb-4"' : ''}>${input.name}</h1>
        <p${isTailwind ? ' className="text-muted-foreground"' : ''}>Generated by Buildr. Describe a feature in the chat to start building.</p>
      </div>
    </main>
  );
}
`,
    },
    {
      path: 'src/app/api/health/route.ts',
      language: 'ts',
      content: `import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ status: "ok", time: new Date().toISOString() });
}
`,
    },
  ]

  return files
}

// ---------------------------------------------------------------------------
// Node + Express scaffold.
// ---------------------------------------------------------------------------

function expressScaffold(input: ScaffoldInput): ScaffoldFile[] {
  const pkgName = slugify(input.name)
  const packageJson = {
    name: pkgName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'node --watch src/index.ts',
      build: 'tsc',
      start: 'node dist/index.js',
    },
    dependencies: {
      express: '^4.21.0',
      cors: '^2.8.5',
      'dotenv': '^16.4.5',
      ...(input.dbConfig.orm === 'prisma'
        ? { '@prisma/client': '^6.11.1' }
        : {}),
    },
    devDependencies: {
      '@types/express': '^5.0.0',
      '@types/cors': '^2.8.17',
      '@types/node': '^20',
      typescript: '^5',
      tsx: '^4.19.0',
      ...(input.dbConfig.orm === 'prisma' ? { prisma: '^6.11.1' } : {}),
    },
  }

  return [
    {
      path: 'package.json',
      language: 'json',
      content: JSON.stringify(packageJson, null, 2) + '\n',
    },
    {
      path: 'tsconfig.json',
      language: 'json',
      content: JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            outDir: 'dist',
            rootDir: 'src',
          },
          include: ['src'],
        },
        null,
        2,
      ) + '\n',
    },
    {
      path: 'src/index.ts',
      language: 'ts',
      content: `import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.get("/", (_req, res) => {
  res.json({ name: ${JSON.stringify(input.name)} });
});

app.listen(PORT, () => {
  console.log(\`${input.name} running on http://localhost:\${PORT}\`);
});
`,
    },
  ]
}

// ---------------------------------------------------------------------------
// React + Vite (SPA) scaffold.
// ---------------------------------------------------------------------------

function viteScaffold(input: ScaffoldInput): ScaffoldFile[] {
  const pkgName = slugify(input.name)
  const packageJson = {
    name: pkgName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: {
      react: '^19.0.0',
      'react-dom': '^19.0.0',
    },
    devDependencies: {
      '@types/react': '^19',
      '@types/react-dom': '^19',
      '@vitejs/plugin-react': '^4.3.0',
      typescript: '^5',
      vite: '^6.0.0',
      ...(input.styling === 'tailwind'
        ? { tailwindcss: '^4.0.0', '@tailwindcss/postcss': '^4' }
        : {}),
    },
  }

  return [
    {
      path: 'package.json',
      language: 'json',
      content: JSON.stringify(packageJson, null, 2) + '\n',
    },
    {
      path: 'vite.config.ts',
      language: 'ts',
      content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
`,
    },
    {
      path: 'index.html',
      language: 'html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${input.name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      path: 'src/main.tsx',
      language: 'tsx',
      content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    },
    {
      path: 'src/App.tsx',
      language: 'tsx',
      content: `export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>${input.name}</h1>
      <p style={{ color: "#555" }}>Generated by Buildr. Add features from chat.</p>
    </main>
  );
}
`,
    },
    {
      path: 'src/index.css',
      language: 'css',
      content: input.styling === 'tailwind'
        ? `@import "tailwindcss";\n`
        : `* { box-sizing: border-box; }
body { margin: 0; }
`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Static HTML scaffold.
// ---------------------------------------------------------------------------

function staticScaffold(input: ScaffoldInput): ScaffoldFile[] {
  return [
    {
      path: 'index.html',
      language: 'html',
      content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${input.name}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <main>
      <header>
        <h1>${input.name}</h1>
        <p>Generated by Buildr.</p>
      </header>
      <section id="app"></section>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`,
    },
    {
      path: 'styles.css',
      language: 'css',
      content: `* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 2rem; }
h1 { font-size: 2.5rem; }
`,
    },
    {
      path: 'app.js',
      language: 'js',
      content: `// ${input.name} — client logic
console.log("${input.name} loaded");
`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Prisma schema per DB engine.
// ---------------------------------------------------------------------------

function prismaSchema(input: ScaffoldInput): ScaffoldFile | null {
  if (input.dbConfig.orm !== 'prisma') return null
  const engine =
    input.dbConfig.engine === 'mysql'
      ? 'mysql'
      : input.dbConfig.engine === 'postgres' || input.dbConfig.engine === 'supabase'
        ? 'postgresql'
        : 'sqlite'
  return {
    path: 'prisma/schema.prisma',
    language: 'prisma',
    content: `// Prisma schema for ${input.name}

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${engine}"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
`,
  }
}

// ---------------------------------------------------------------------------
// Public entry — assemble the scaffold.
// ---------------------------------------------------------------------------

export function buildScaffold(input: ScaffoldInput): ScaffoldFile[] {
  let files: ScaffoldFile[]
  switch (input.stack) {
    case 'nextjs':
      files = nextjsScaffold(input)
      break
    case 'node-express':
      files = expressScaffold(input)
      break
    case 'react-vite':
      files = viteScaffold(input)
      break
    case 'static-html':
      files = staticScaffold(input)
      break
    default:
      files = nextjsScaffold(input)
  }

  const prisma = prismaSchema(input)
  if (prisma) files.push(prisma)

  files.push(readme(input.name, input.prompt.slice(0, 200) || 'Built with Buildr.'))
  files.push(envExample(input.integrations ?? [], input.dbConfig))
  files.push(gitignore(input.stack))
  files.push({
    path: 'Dockerfile',
    language: 'sh',
    content: `FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "start"]
`,
  })

  return files
}
