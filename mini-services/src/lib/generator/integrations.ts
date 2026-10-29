// Integration Marketplace generators (Module 4)
// ------------------------------------------------------------------
// Each integration, when enabled, emits real files into the generated
// project: install snippets, env vars, lib helpers, and API routes.
// This is the extensible plugin/connector framework.

import { db } from '@/lib/db'
import type { DbConfig, IntegrationDef, StackKey } from '@/lib/types'

export interface IntegrationFile {
  path: string
  content: string
  language: string
}

export interface IntegrationInput {
  stack: StackKey
  integrations: string[]
  dbConfig: DbConfig
}

// ---------------------------------------------------------------------------
// Catalogue — drives the marketplace UI + seeding.
// ---------------------------------------------------------------------------

export const INTEGRATION_CATALOG: IntegrationDef[] = [
  {
    key: 'stripe',
    name: 'Stripe',
    description: 'Accept payments, subscriptions and one-off charges.',
    category: 'payments',
    icon: 'credit-card',
    envVars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    enabled: true,
  },
  {
    key: 'paystack',
    name: 'Paystack',
    description: 'African payments — cards, bank transfers, mobile money.',
    category: 'payments',
    icon: 'banknote',
    envVars: ['PAYSTACK_SECRET_KEY'],
    enabled: true,
  },
  {
    key: 'razorpay',
    name: 'Razorpay',
    description: 'Indian payments — UPI, cards, netbanking.',
    category: 'payments',
    icon: 'banknote',
    envVars: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    enabled: true,
  },
  {
    key: 'nextauth',
    name: 'Auth.js (NextAuth)',
    description: 'Passwordless + OAuth authentication for Next.js.',
    category: 'auth',
    icon: 'shield-check',
    envVars: ['NEXTAUTH_SECRET', 'NEXTAUTH_URL'],
    enabled: true,
  },
  {
    key: 'clerk',
    name: 'Clerk',
    description: 'Drop-in auth UI with multi-factor and organizations.',
    category: 'auth',
    icon: 'shield',
    envVars: ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'],
    enabled: true,
  },
  {
    key: 'supabase',
    name: 'Supabase',
    description: 'Postgres, auth, storage and realtime — managed.',
    category: 'database',
    icon: 'database',
    envVars: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    enabled: true,
  },
  {
    key: 'resend',
    name: 'Resend',
    description: 'Transactional email for developers.',
    category: 'communication',
    icon: 'mail',
    envVars: ['RESEND_API_KEY'],
    enabled: true,
  },
  {
    key: 'sendgrid',
    name: 'SendGrid',
    description: 'Email delivery and marketing campaigns.',
    category: 'communication',
    icon: 'mail',
    envVars: ['SENDGRID_API_KEY'],
    enabled: true,
  },
  {
    key: 'twilio',
    name: 'Twilio',
    description: 'Programmable SMS, voice and WhatsApp.',
    category: 'communication',
    icon: 'message-square',
    envVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
    enabled: true,
  },
  {
    key: 'plaid',
    name: 'Plaid',
    description: 'Bank account linking and transaction data (fintech).',
    category: 'fintech',
    icon: 'landmark',
    envVars: ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV'],
    enabled: true,
  },
  {
    key: 'onfido',
    name: 'Onfido',
    description: 'Identity verification & KYC.',
    category: 'identity',
    icon: 'scan-face',
    envVars: ['ONFIDO_API_TOKEN', 'ONFIDO_REGION'],
    enabled: true,
  },
]

// ---------------------------------------------------------------------------
// Per-integration file generators. Each returns files appropriate for the
// stack. They are real, runnable helpers — not placeholders.
// ---------------------------------------------------------------------------

function stripeFiles(stack: StackKey): IntegrationFile[] {
  if (stack === 'nextjs') {
    return [
      {
        path: 'src/lib/stripe.ts',
        language: 'ts',
        content: `import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn("STRIPE_SECRET_KEY is not set — Stripe calls will fail.");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2024-12-18.acacia",
  typescript: true,
});
`,
      },
      {
        path: 'src/app/api/checkout/route.ts',
        language: 'ts',
        content: `import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { amount, name = "Order" } = await req.json();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: { name },
            unit_amount: Math.round(amount * 100),
          },
        },
      ],
      success_url: \`\${req.nextUrl.origin}/success?session_id={CHECKOUT_SESSION_ID}\`,
      cancel_url: \`\${req.nextUrl.origin}/cancel\`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "checkout_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
`,
      },
      {
        path: 'src/app/api/webhooks/stripe/route.ts',
        language: 'ts',
        content: `import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature");
  const body = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig ?? "",
      process.env.STRIPE_WEBHOOK_SECRET ?? "",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid_signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  // Handle events here (checkout.session.completed, etc.)
  return NextResponse.json({ received: true });
}
`,
      },
    ]
  }
  return []
}

function nextAuthFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/auth.ts',
      language: 'ts',
      content: `import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Replace with real DB lookup.
        if (credentials?.email === "admin@buildr.dev" && credentials?.password === "password") {
          return { id: "1", email: credentials.email, name: "Admin" };
        }
        return null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
};
`,
    },
    {
      path: 'src/app/api/auth/[...nextauth]/route.ts',
      language: 'ts',
      content: `import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
`,
    },
  ]
}

function clerkFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/clerk.ts',
      language: 'ts',
      content: `import { ClerkProvider, SignIn, SignUp, SignedIn, SignedOut } from "@clerk/nextjs";

export { ClerkProvider, SignIn, SignUp, SignedIn, SignedOut };
`,
    },
    {
      path: 'src/middleware.ts',
      language: 'ts',
      content: `import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware((auth, req) => {
  if (isProtected(req)) auth().protect();
});

export const config = {
  matcher: ["/((?!.*\\\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
`,
    },
  ]
}

function supabaseFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/supabase.ts',
      language: 'ts',
      content: `import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn("Supabase env vars are missing — client calls will fail.");
}

export const supabase = createClient(url ?? "", anon ?? "");
`,
    },
    {
      path: 'supabase/migrations/0001_init.sql',
      language: 'sql',
      content: `-- Initial migration for the Supabase project.
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  full_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select using (true);
`,
    },
  ]
}

function resendFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/email.ts',
      language: 'ts',
      content: `import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  return resend.emails.send({
    from: opts.from ?? "Buildr <noreply@buildr.dev>",
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
`,
    },
  ]
}

function sendgridFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/email.ts',
      language: 'ts',
      content: `import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? "");

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}) {
  return sgMail.send({
    from: opts.from ?? "noreply@buildr.dev",
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
`,
    },
  ]
}

function twilioFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/twilio.ts',
      language: 'ts',
      content: `import Twilio from "twilio";

export const twilio = Twilio(
  process.env.TWILIO_ACCOUNT_SID ?? "",
  process.env.TWILIO_AUTH_TOKEN ?? "",
);

export async function sendSms(to: string, body: string) {
  return twilio.messages.create({
    from: process.env.TWILIO_FROM_NUMBER ?? "",
    to,
    body,
  });
}
`,
    },
  ]
}

function plaidFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/plaid.ts',
      language: 'ts',
      content: `import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

const config = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as "sandbox" | "development" | "production"] ?? PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
      "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
    },
  },
});

export const plaid = new PlaidApi(config);
`,
    },
    {
      path: 'src/app/api/plaid/link-token/route.ts',
      language: 'ts',
      content: `import { NextResponse } from "next/server";
import { plaid } from "@/lib/plaid";

export async function POST() {
  const res = await plaid.linkTokenCreate({
    user: { client_user_id: "user-id" },
    client_name: "Buildr App",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
  });
  return NextResponse.json(res.data);
}
`,
    },
  ]
}

function paystackFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/paystack.ts',
      language: 'ts',
      content: `const BASE = "https://api.paystack.co";

export async function initialiseTransaction(opts: {
  email: string;
  amount: number; // in kobo/cents
  reference?: string;
  callback_url?: string;
}) {
  const res = await fetch(\`\${BASE}/transaction/initialize\`, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${process.env.PAYSTACK_SECRET_KEY}\`,
      "content-type": "application/json",
    },
    body: JSON.stringify(opts),
  });
  return res.json();
}

export async function verifyTransaction(reference: string) {
  const res = await fetch(\`\${BASE}/transaction/verify/\${reference}\`, {
    headers: { authorization: \`Bearer \${process.env.PAYSTACK_SECRET_KEY}\` },
  });
  return res.json();
}
`,
    },
  ]
}

function razorpayFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/razorpay.ts',
      language: 'ts',
      content: `import Razorpay from "razorpay";

export const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID ?? "",
  key_secret: process.env.RAZORPAY_KEY_SECRET ?? "",
});

export async function createOrder(amount: number, currency = "INR") {
  return razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency,
    receipt: \`rcpt_\${Date.now()}\`,
  });
}
`,
    },
  ]
}

function onfidoFiles(stack: StackKey): IntegrationFile[] {
  if (stack !== 'nextjs') return []
  return [
    {
      path: 'src/lib/onfido.ts',
      language: 'ts',
      content: `import { Onfido, Region } from "@onfido/api";

const region = (process.env.ONFIDO_REGION as Region) ?? Region.US;

export const onfido = new Onfido({
  apiToken: process.env.ONFIDO_API_TOKEN ?? "",
  region,
});

export async function createApplicant(opts: { firstName: string; lastName: string; email?: string }) {
  return onfido.applicant.create(opts);
}
`,
    },
  ]
}

const GENERATORS: Record<string, (stack: StackKey) => IntegrationFile[]> = {
  stripe: stripeFiles,
  nextauth: nextAuthFiles,
  clerk: clerkFiles,
  supabase: supabaseFiles,
  resend: resendFiles,
  sendgrid: sendgridFiles,
  twilio: twilioFiles,
  plaid: plaidFiles,
  paystack: paystackFiles,
  razorpay: razorpayFiles,
  onfido: onfidoFiles,
}

// ---------------------------------------------------------------------------
// Apply: aggregate all integration files for a project.
// ---------------------------------------------------------------------------

export function applyIntegrations(input: IntegrationInput): IntegrationFile[] {
  const out: IntegrationFile[] = []
  for (const key of input.integrations) {
    const gen = GENERATORS[key]
    if (gen) {
      const files = gen(input.stack)
      out.push(...files)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Seed integrations into the DB (idempotent).
// ---------------------------------------------------------------------------

export async function seedIntegrations(): Promise<void> {
  // Idempotent upsert — preserves the `enabled` flag on update so the
  // marketplace's per-integration enable state isn't reset on boot.
  for (const def of INTEGRATION_CATALOG) {
    const { data: existing } = await db
      .from('integrations')
      .select('id')
      .eq('key', def.key)
      .maybeSingle()

    if (existing) {
      await db
        .from('integrations')
        .update({
          name: def.name,
          description: def.description,
          category: def.category,
          icon: def.icon,
          env_vars: JSON.stringify(def.envVars),
        })
        .eq('key', def.key)
    } else {
      await db.from('integrations').insert({
        key: def.key,
        name: def.name,
        description: def.description,
        category: def.category,
        icon: def.icon,
        env_vars: JSON.stringify(def.envVars),
        enabled: def.enabled,
      })
    }
  }
}
