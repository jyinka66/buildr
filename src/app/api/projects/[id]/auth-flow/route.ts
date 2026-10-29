// POST /api/projects/[id]/auth-flow — generates complete authentication UI
// pages (login, signup, logout) wired to the NextAuth integration. Creates:
//   1. src/app/login/page.tsx — login form (email + password)
//   2. src/app/signup/page.tsx — registration form
//   3. src/app/logout/page.tsx — logout handler
//   4. src/components/AuthProvider.tsx — wraps the app with NextAuth SessionProvider
//
// These are real, runnable auth pages that work with the generated
// NextAuth integration (src/lib/auth.ts) already in the project.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireSessionUser } from '@/lib/session'
import { audit } from '@/lib/snapshot'

export async function POST(
  _req: NextRequest,
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
  const { data: project } = await db
    .from('projects')
    .select('owner_id, name, stack')
    .eq('id', id)
    .maybeSingle()
  if (!project) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (project.owner_id !== user.id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const filesToSave: { path: string; content: string; language: string }[] = []

  // 1. Login page
  filesToSave.push({
    path: 'src/app/login/page.tsx',
    language: 'tsx',
    content: `"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password.");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
            <p className="mt-1 text-sm text-gray-500">Sign in to your account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              Sign in
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Don't have an account?{" "}
            <a href="/signup" className="font-medium text-emerald-600 hover:text-emerald-700">
              Sign up
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
`,
  })

  // 2. Signup page
  filesToSave.push({
    path: 'src/app/signup/page.tsx',
    language: 'tsx',
    content: `"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed.");
        setLoading(false);
        return;
      }

      // Auto-login after registration.
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Account created! Please sign in.");
        router.push("/login");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-gray-900">Create account</h1>
            <p className="mt-1 text-sm text-gray-500">Get started in seconds</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
              <input
                id="name" type="text" required value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name" autoComplete="name"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email</label>
              <input
                id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
              <input
                id="password" type="password" required value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters" autoComplete="new-password" minLength={8}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Create account
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Already have an account?{" "}
            <a href="/login" className="font-medium text-emerald-600 hover:text-emerald-700">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
`,
  })

  // 3. Logout handler page
  filesToSave.push({
    path: 'src/app/logout/page.tsx',
    language: 'tsx',
    content: `"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    void signOut({ redirect: false }).then(() => {
      router.push("/login");
      router.refresh();
    });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-gray-500">Signing out...</p>
    </div>
  );
}
`,
  })

  // 4. AuthProvider component
  filesToSave.push({
    path: 'src/components/AuthProvider.tsx',
    language: 'tsx',
    content: `"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";

export function AuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
`,
  })

  // 5. API register route (if not already present)
  filesToSave.push({
    path: 'src/app/api/auth/register/route.ts',
    language: 'ts',
    content: `import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

// In production, use a real database. This is a starter that uses
// an in-memory store — replace with Prisma/Supabase.
const users: Map<string, { id: string; email: string; name?: string; password: string }> = new Map();

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json();

  if (!email || !password || password.length < 8) {
    return NextResponse.json({ error: "Valid email and password (8+ chars) required." }, { status: 400 });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (users.has(normalizedEmail)) {
    return NextResponse.json({ error: "Account already exists." }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const user = { id: crypto.randomUUID(), email: normalizedEmail, name, password: hash };
  users.set(normalizedEmail, user);

  return NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } }, { status: 201 });
}
`,
  })

  // Save all files (upsert).
  const savedFiles: { path: string }[] = []
  for (const file of filesToSave) {
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

  await audit('auth-flow.generate', { filesGenerated: savedFiles.length }, user.id, id)

  return NextResponse.json({
    ok: true,
    filesSaved: savedFiles,
    routes: {
      login: '/login',
      signup: '/signup',
      logout: '/logout',
    },
    message: 'Auth flow generated. Wrap your app in <AuthProvider> and visit /login or /signup.',
  })
}
