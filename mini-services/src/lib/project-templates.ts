// Project Templates Gallery (P1 — growth lever)
// ------------------------------------------------------------------
// Pre-built starting points so users get instant value instead of a blank
// prompt. Each template defines a prompt + a set of complete files that
// load instantly. The user then iterates via chat.
//
// Templates are REAL file sets (not just prompts) so the preview renders
// immediately on project creation — even before the LLM generates anything.

import type { StackKey, StylingKey, DbConfig } from '@/lib/types'

export interface TemplateFile {
  path: string
  content: string
  language: string
}

export interface ProjectTemplate {
  key: string
  name: string
  description: string
  icon: string
  stack: StackKey
  styling: StylingKey
  dbConfig: DbConfig
  integrations: string[]
  prompt: string
  files: TemplateFile[]
}

// ---------------------------------------------------------------------------
// Template 1: SaaS Landing Page
// ---------------------------------------------------------------------------

const SAAS_TEMPLATE: ProjectTemplate = {
  key: 'saas-landing',
  name: 'SaaS Landing Page',
  description: 'A polished marketing landing page with hero, features, pricing, and CTA sections.',
  icon: 'Rocket',
  stack: 'nextjs',
  styling: 'tailwind',
  dbConfig: { engine: 'none', orm: 'none' },
  integrations: [],
  prompt: 'A SaaS landing page with a hero section, features grid, pricing table, testimonials, and a CTA. Emerald accent colors, modern and clean.',
  files: [
    {
      path: 'src/app/page.tsx',
      language: 'tsx',
      content: `export default function Home() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <Hero />
      <Features />
      <Pricing />
      <CTA />
    </main>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          Now in beta
        </span>
        <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">
          Ship your product
          <span className="block text-emerald-600">10x faster</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-600">
          The all-in-one platform that helps teams build, deploy, and scale
          without the boilerplate.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <a href="#" className="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
            Start free
          </a>
          <a href="#" className="rounded-lg border border-zinc-300 px-6 py-3 text-sm font-semibold hover:bg-zinc-50">
            Book a demo
          </a>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { title: 'Lightning fast', desc: 'Built on edge infrastructure for sub-50ms response times.' },
    { title: 'Secure by default', desc: 'SOC 2 compliant with end-to-end encryption.' },
    { title: 'Easy to scale', desc: 'From zero to millions of users without re-architecting.' },
  ];
  return (
    <section className="border-t border-zinc-100 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-3xl font-bold">Everything you need</h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-zinc-200 p-6">
              <h3 className="font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-zinc-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    { name: 'Starter', price: 0, desc: 'For side projects', features: ['1 project', 'Community support', '100 requests/day'] },
    { name: 'Pro', price: 29, desc: 'For growing teams', features: ['Unlimited projects', 'Email support', '10k requests/day', 'Custom domains'] },
    { name: 'Enterprise', price: 99, desc: 'For production apps', features: ['Everything in Pro', 'SLA guarantee', 'Unlimited requests', 'Dedicated support'] },
  ];
  return (
    <section className="border-t border-zinc-100 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center text-3xl font-bold">Simple pricing</h2>
        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {plans.map((p, i) => (
            <div key={p.name} className={'rounded-xl border p-6 ' + (i === 1 ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-zinc-200')}>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-zinc-500">{p.desc}</p>
              <p className="mt-4 text-4xl font-bold">\${p.price}<span className="text-base font-normal text-zinc-500">/mo</span></p>
              <ul className="mt-6 space-y-2 text-sm text-zinc-600">
                {p.features.map((f) => <li key={f}>✓ {f}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-2xl bg-zinc-900 p-12 text-center text-white">
        <h2 className="text-3xl font-bold">Ready to get started?</h2>
        <p className="mt-3 text-zinc-400">Join thousands of teams building with us.</p>
        <a href="#" className="mt-6 inline-block rounded-lg bg-emerald-500 px-8 py-3 text-sm font-semibold text-white hover:bg-emerald-400">
          Create free account
        </a>
      </div>
    </section>
  );
}
`,
    },
  ],
}

// ---------------------------------------------------------------------------
// Template 2: Admin Dashboard
// ---------------------------------------------------------------------------

const ADMIN_TEMPLATE: ProjectTemplate = {
  key: 'admin-dashboard',
  name: 'Admin Dashboard',
  description: 'A dashboard with sidebar nav, KPI cards, a data table, and a chart.',
  icon: 'LayoutDashboard',
  stack: 'nextjs',
  styling: 'tailwind',
  dbConfig: { engine: 'sqlite', orm: 'prisma' },
  integrations: [],
  prompt: 'An admin dashboard with a sidebar, top KPI cards (revenue, users, orders, growth), a recent orders table, and a revenue trend chart. Dark sidebar, light content area.',
  files: [
    {
      path: 'src/app/page.tsx',
      language: 'tsx',
      content: `'use client';

import { useState } from 'react';

interface Order {
  id: string;
  customer: string;
  amount: number;
  status: 'pending' | 'completed' | 'refunded';
  date: string;
}

const mockOrders: Order[] = [
  { id: 'ORD-001', customer: 'Alice Johnson', amount: 299, status: 'completed', date: '2024-01-15' },
  { id: 'ORD-002', customer: 'Bob Smith', amount: 149, status: 'pending', date: '2024-01-15' },
  { id: 'ORD-003', customer: 'Carol White', amount: 599, status: 'completed', date: '2024-01-14' },
  { id: 'ORD-004', customer: 'Dave Brown', amount: 79, status: 'refunded', date: '2024-01-14' },
  { id: 'ORD-005', customer: 'Eve Davis', amount: 449, status: 'completed', date: '2024-01-13' },
];

const statusColors: Record<Order['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  refunded: 'bg-red-100 text-red-700',
};

export default function Dashboard() {
  const [orders] = useState(mockOrders);

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <header className="border-b border-zinc-200 bg-white px-6 py-4">
          <h1 className="text-lg font-semibold">Dashboard</h1>
        </header>
        <main className="flex-1 p-6">
          <KpiCards />
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <RevenueChart />
            </div>
            <RecentActivity />
          </div>
          <OrdersTable orders={orders} />
        </main>
      </div>
    </div>
  );
}

function Sidebar() {
  const items = ['Dashboard', 'Orders', 'Customers', 'Products', 'Analytics', 'Settings'];
  return (
    <aside className="w-60 bg-zinc-900 text-zinc-300">
      <div className="px-6 py-5">
        <span className="text-lg font-bold text-white">Acme Inc</span>
      </div>
      <nav className="px-3">
        {items.map((item, i) => (
          <a
            key={item}
            href="#"
            className={'block rounded-md px-3 py-2 text-sm ' + (i === 0 ? 'bg-emerald-600 text-white' : 'hover:bg-zinc-800')}
          >
            {item}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function KpiCards() {
  const kpis = [
    { label: 'Revenue', value: '$48,290', change: '+12.5%', up: true },
    { label: 'Users', value: '2,847', change: '+8.2%', up: true },
    { label: 'Orders', value: '1,294', change: '-3.1%', up: false },
    { label: 'Growth', value: '18.4%', change: '+2.4%', up: true },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">{k.label}</p>
          <p className="mt-1 text-2xl font-bold">{k.value}</p>
          <p className={'mt-1 text-xs ' + (k.up ? 'text-emerald-600' : 'text-red-600')}>
            {k.change} vs last month
          </p>
        </div>
      ))}
    </div>
  );
}

function RevenueChart() {
  const data = [40, 55, 45, 70, 65, 80, 75, 90, 85, 95];
  const max = Math.max(...data);
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h3 className="font-semibold">Revenue trend</h3>
      <div className="mt-4 flex h-40 items-end gap-2">
        {data.map((v, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-emerald-500"
            style={{ height: (v / max) * 100 + '%' }}
          />
        ))}
      </div>
    </div>
  );
}

function RecentActivity() {
  const activities = [
    'New order #ORD-005 from Eve Davis',
    'Customer Carol White upgraded plan',
    'Refund processed for ORD-004',
    'New signup: Frank Miller',
  ];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h3 className="font-semibold">Recent activity</h3>
      <ul className="mt-4 space-y-3 text-sm">
        {activities.map((a) => (
          <li key={a} className="flex items-start gap-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
            <span className="text-zinc-600">{a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <div className="mt-6 rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-5 py-4">
        <h3 className="font-semibold">Recent orders</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-zinc-500">
              <th className="px-5 py-3 font-medium">Order</th>
              <th className="px-5 py-3 font-medium">Customer</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-zinc-50">
                <td className="px-5 py-3 font-mono text-xs">{o.id}</td>
                <td className="px-5 py-3">{o.customer}</td>
                <td className="px-5 py-3 font-medium">\${o.amount}</td>
                <td className="px-5 py-3">
                  <span className={'inline-block rounded-full px-2 py-0.5 text-xs font-medium ' + statusColors[o.status]}>
                    {o.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-zinc-500">{o.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`,
    },
  ],
}

// ---------------------------------------------------------------------------
// Template 3: API-Only Service
// ---------------------------------------------------------------------------

const API_TEMPLATE: ProjectTemplate = {
  key: 'api-service',
  name: 'API Service',
  description: 'A REST API with health check, CRUD endpoints, and structured error handling.',
  icon: 'Server',
  stack: 'node-express',
  styling: 'plain',
  dbConfig: { engine: 'sqlite', orm: 'prisma' },
  integrations: [],
  prompt: 'A REST API service with a health check endpoint, a /api/items CRUD resource (list, create, get by id, update, delete), and structured JSON error handling.',
  files: [
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

// In-memory data store (replace with Prisma in production).
interface Item {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

const items: Map<string, Item> = new Map();

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), uptime: process.uptime() });
});

// List items
app.get("/api/items", (_req, res) => {
  const list = Array.from(items.values());
  res.json({ data: list, count: list.length });
});

// Get single item
app.get("/api/items/:id", (req, res) => {
  const item = items.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: "not_found", message: "Item not found" });
  }
  res.json({ data: item });
});

// Create item
app.post("/api/items", (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    return res.status(400).json({ error: "validation_error", message: "name is required" });
  }
  const id = crypto.randomUUID();
  const item: Item = {
    id,
    name: String(name),
    description: String(description || ""),
    createdAt: new Date().toISOString(),
  };
  items.set(id, item);
  res.status(201).json({ data: item });
});

// Update item
app.put("/api/items/:id", (req, res) => {
  const item = items.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: "not_found", message: "Item not found" });
  }
  const { name, description } = req.body;
  if (name) item.name = String(name);
  if (description) item.description = String(description);
  items.set(item.id, item);
  res.json({ data: item });
});

// Delete item
app.delete("/api/items/:id", (req, res) => {
  if (!items.has(req.params.id)) {
    return res.status(404).json({ error: "not_found", message: "Item not found" });
  }
  items.delete(req.params.id);
  res.status(204).send();
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "not_found", message: "Route not found" });
});

// Error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: err.message });
});

app.listen(PORT, () => {
  console.log(\`API service running on http://localhost:\${PORT}\`);
});
`,
    },
  ],
}

// ---------------------------------------------------------------------------
// Template 4: Blog
// ---------------------------------------------------------------------------

const BLOG_TEMPLATE: ProjectTemplate = {
  key: 'blog',
  name: 'Blog',
  description: 'A blog with a post list, individual post pages, and a clean reading layout.',
  icon: 'FileText',
  stack: 'nextjs',
  styling: 'tailwind',
  dbConfig: { engine: 'sqlite', orm: 'prisma' },
  integrations: [],
  prompt: 'A blog with a homepage listing posts (title, excerpt, date, author), and a post detail page with full content and a back link. Clean typography, generous whitespace.',
  files: [
    {
      path: 'src/app/page.tsx',
      language: 'tsx',
      content: `interface Post {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  author: string;
}

const posts: Post[] = [
  { slug: 'getting-started', title: 'Getting Started with Next.js', excerpt: 'A beginner-friendly guide to building your first app with the App Router.', date: '2024-01-15', author: 'Ada Lovelace' },
  { slug: 'styling-tailwind', title: 'Mastering Tailwind CSS', excerpt: 'Tips and patterns for building beautiful UIs with utility classes.', date: '2024-01-12', author: 'Grace Hopper' },
  { slug: 'api-routes', title: 'Building APIs with Route Handlers', excerpt: 'How to create REST endpoints in Next.js 16 with the new App Router.', date: '2024-01-08', author: 'Alan Turing' },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <header className="border-b border-zinc-100">
        <div className="mx-auto max-w-2xl px-4 py-6">
          <h1 className="text-xl font-bold tracking-tight">The Devlog</h1>
          <p className="text-sm text-zinc-500">Thoughts on building software</p>
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h2 className="mb-8 text-2xl font-bold">Latest posts</h2>
        <div className="space-y-8">
          {posts.map((post) => (
            <article key={post.slug} className="group">
              <a href={'/posts/' + post.slug} className="block">
                <h3 className="text-lg font-semibold group-hover:text-emerald-600">{post.title}</h3>
                <p className="mt-1 text-sm text-zinc-600">{post.excerpt}</p>
                <p className="mt-2 text-xs text-zinc-400">{post.date} · {post.author}</p>
              </a>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
`,
    },
  ],
}

// ---------------------------------------------------------------------------
// Template 5: Portfolio
// ---------------------------------------------------------------------------

const PORTFOLIO_TEMPLATE: ProjectTemplate = {
  key: 'portfolio',
  name: 'Portfolio',
  description: 'A personal portfolio with a hero, project grid, skills, and contact section.',
  icon: 'User',
  stack: 'nextjs',
  styling: 'tailwind',
  dbConfig: { engine: 'none', orm: 'none' },
  integrations: [],
  prompt: 'A personal portfolio website with a hero section (name + tagline), a projects grid with images, a skills list, and a contact section with social links. Emerald accent.',
  files: [
    {
      path: 'src/app/page.tsx',
      language: 'tsx',
      content: `interface Project {
  title: string;
  description: string;
  tags: string[];
  url: string;
}

const projects: Project[] = [
  { title: 'TaskFlow', description: 'A real-time collaborative task manager with drag-and-drop.', tags: ['Next.js', 'WebSocket', 'Prisma'], url: '#' },
  { title: 'DataViz', description: 'An interactive dashboard for visualizing complex datasets.', tags: ['React', 'D3.js', 'TypeScript'], url: '#' },
  { title: 'ShopLite', description: 'A minimalist e-commerce storefront with Stripe checkout.', tags: ['Next.js', 'Stripe', 'Tailwind'], url: '#' },
  { title: 'NoteAI', description: 'An AI-powered note-taking app with semantic search.', tags: ['React', 'OpenAI', 'Vector DB'], url: '#' },
];

const skills = ['TypeScript', 'React', 'Next.js', 'Node.js', 'PostgreSQL', 'Tailwind CSS', 'Prisma', 'Docker'];

export default function Home() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <Hero />
      <Projects />
      <Skills />
      <Contact />
    </main>
  );
}

function Hero() {
  return (
    <section className="px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mx-auto mb-6 h-24 w-24 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500" />
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Hi, I'm <span className="text-emerald-600">Alex Carter</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-zinc-600">
          Full-stack developer building delightful web experiences with
          modern tools and clean code.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <a href="#projects" className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
            View work
          </a>
          <a href="#contact" className="rounded-lg border border-zinc-300 px-6 py-2.5 text-sm font-semibold hover:bg-zinc-50">
            Get in touch
          </a>
        </div>
      </div>
    </section>
  );
}

function Projects() {
  return (
    <section id="projects" className="border-t border-zinc-100 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-3xl font-bold">Selected work</h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {projects.map((p) => (
            <a key={p.title} href={p.url} className="group rounded-xl border border-zinc-200 p-6 transition hover:border-emerald-300 hover:shadow-md">
              <h3 className="text-lg font-semibold group-hover:text-emerald-600">{p.title}</h3>
              <p className="mt-2 text-sm text-zinc-600">{p.description}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {p.tags.map((t) => (
                  <span key={t} className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{t}</span>
                ))}
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function Skills() {
  return (
    <section className="border-t border-zinc-100 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold">Skills</h2>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {skills.map((s) => (
            <span key={s} className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700">
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section id="contact" className="border-t border-zinc-100 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-bold">Let's work together</h2>
        <p className="mx-auto mt-4 max-w-md text-zinc-600">
          I'm currently available for freelance projects and full-time roles.
        </p>
        <div className="mt-8 flex justify-center gap-4">
          <a href="mailto:hello@example.com" className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
            Email me
          </a>
          <a href="#" className="rounded-lg border border-zinc-300 px-6 py-2.5 text-sm font-semibold hover:bg-zinc-50">
            GitHub
          </a>
          <a href="#" className="rounded-lg border border-zinc-300 px-6 py-2.5 text-sm font-semibold hover:bg-zinc-50">
            LinkedIn
          </a>
        </div>
      </div>
    </section>
  );
}
`,
    },
  ],
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  SAAS_TEMPLATE,
  ADMIN_TEMPLATE,
  API_TEMPLATE,
  BLOG_TEMPLATE,
  PORTFOLIO_TEMPLATE,
]

export function getTemplate(key: string): ProjectTemplate | null {
  return PROJECT_TEMPLATES.find((t) => t.key === key) ?? null
}
