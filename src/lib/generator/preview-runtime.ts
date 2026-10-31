// In-Browser React Preview Runtime (Module 3 — self-hosted)
// ------------------------------------------------------------------
// Instead of shipping the generated code to an external runtime service
// (WebContainers API) or rendering a static structural shell, this module
// produces a self-contained HTML document that ACTUALLY EXECUTES the
// generated React/Next.js code in the browser:
//
//   1. Babel Standalone (loaded once) transpiles each TS/TSX source string
//      in-browser (presets: env/commonjs, react/classic-runtime, typescript).
//   2. A CommonJS-style `require()` shim resolves imports:
//        - bare specifiers (react, next/*, lucide-react, supabase, stripe…)
//          → a registry of real-where-possible / mocked modules
//        - local specifiers (@/…, ./…, ../…) → recursively resolved + executed
//        - unknown → a stub Proxy that returns a no-op component
//   3. React 19 createRoot mounts the entry component's default export.
//   4. Tailwind Play CDN compiles utility classes on the fly.
//
// What this gives: a LIVE, INTERACTIVE render of the user's actual generated
// UI. Clicks fire, useState updates, forms render. API routes, server
// components, and real DB calls are stubbed (clearly bannered) — for the
// full-stack runtime the user exports the ZIP and runs locally.
//
// Everything executes inside a sandboxed iframe (allow-scripts). No remote
// service runs the user's code. The only external resources are the library
// bundles themselves (React/Babel/Tailwind UMDs from CDNs) — these are
// static assets, not execution APIs.

import type { StackKey } from '@/lib/types'

interface PreviewFile {
  path: string
  content: string
  language: string
}

export interface PreviewBundleResult {
  html: string
  mode: 'static' | 'react' | 'none'
}

// ---------------------------------------------------------------------------
// Entry detection per stack.
// ---------------------------------------------------------------------------

function findEntry(files: PreviewFile[], stack: StackKey): PreviewFile | null {
  const candidates: string[] = []
  if (stack === 'nextjs') {
    candidates.push('src/app/page.tsx', 'src/pages/index.tsx', 'src/app/(home)/page.tsx')
  } else if (stack === 'react-vite') {
    candidates.push('src/App.tsx', 'src/App.jsx', 'src/app.tsx')
  }
  for (const c of candidates) {
    const f = files.find((f) => f.path === c)
    if (f) return f
  }
  // Fallback: any page.tsx / App.tsx.
  return (
    files.find((f) => f.path.endsWith('page.tsx')) ??
    files.find((f) => f.path.endsWith('App.tsx')) ??
    null
  )
}

// ---------------------------------------------------------------------------
// Local import collection. BFS from the entry, parsing ESM import
// specifiers, gathering all locally-resolvable files.
// ---------------------------------------------------------------------------

const IMPORT_RE = /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g

function isLocal(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('@/')
}

function resolveLocal(spec: string, fromPath: string, available: Set<string>): string | null {
  let target = spec
  if (target.startsWith('@/')) {
    target = 'src/' + target.slice(2)
  } else if (target.startsWith('.') ) {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
    target = dir + '/' + spec
    const parts = target.split('/')
    const out: string[] = []
    for (const p of parts) {
      if (p === '.' || p === '') continue
      if (p === '..') {
        out.pop()
        continue
      }
      out.push(p)
    }
    target = out.join('/')
  } else {
    return null
  }
  const candidates = [
    target,
    target + '.tsx',
    target + '.ts',
    target + '.jsx',
    target + '.js',
    target + '/index.tsx',
    target + '/index.ts',
  ]
  for (const c of candidates) {
    if (available.has(c)) return c
  }
  return null
}

function collectDeps(
  entry: PreviewFile,
  allFiles: Map<string, PreviewFile>,
): Map<string, string> {
  const available = new Set(allFiles.keys())
  const collected = new Map<string, string>()
  const queue: string[] = [entry.path]
  const seen = new Set<string>([entry.path])

  while (queue.length) {
    const path = queue.shift()!
    const file = allFiles.get(path)
    if (!file) continue
    collected.set(path, file.content)

    let m: RegExpExecArray | null
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(file.content)) !== null) {
      const spec = m[1]
      if (!isLocal(spec)) continue
      // skip CSS/assets
      if (/\.(css|scss|svg|png|jpe?g|gif|webp|woff2?)$/i.test(spec)) continue
      const resolved = resolveLocal(spec, path, available)
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved)
        queue.push(resolved)
      }
    }
  }
  return collected
}

// ---------------------------------------------------------------------------
// Custom CSS extraction — pull globals.css / index.css and strip the
// @import "tailwindcss" line (Tailwind Play CDN handles that).
// ---------------------------------------------------------------------------

function extractCustomCss(files: PreviewFile[]): string {
  const cssFile =
    files.find((f) => f.path === 'src/app/globals.css') ??
    files.find((f) => f.path === 'src/index.css') ??
    files.find((f) => f.path.endsWith('globals.css'))
  if (!cssFile) return ''
  return cssFile.content
    .replace(/@import\s+["']tailwindcss["'];?\s*/gi, '')
    .replace(/@import\s+["']tw-animate-css["'];?\s*/gi, '')
    .replace(/@custom-variant[^;]+;\s*/g, '')
    .trim()
}

// ---------------------------------------------------------------------------
// The runtime JS (executed in the iframe). References window.React etc.
// Kept as a string; injected verbatim into the HTML.
// ---------------------------------------------------------------------------

const RUNTIME_JS = `
(function(){
  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var ReactDOMClient = (ReactDOM && ReactDOM.createRoot) ? ReactDOM : ((window.ReactDOMClient && window.ReactDOMClient.createRoot) ? window.ReactDOMClient : null);
  var errorBox = document.getElementById('__preview-error');

  function showError(err){
    if (!errorBox) return;
    errorBox.style.display = 'block';
    var msg = (err && (err.stack || err.message)) || String(err);
    errorBox.innerHTML = '<strong>Preview render error</strong><pre></pre>';
    errorBox.querySelector('pre').textContent = msg;
  }

  if (!React || !ReactDOMClient || !window.Babel) {
    showError(new Error('Runtime libraries (React/Babel) failed to load. Check your network connection.'));
    return;
  }

  // ---- safe preview network boundary -----------------------------------
  // Generated code runs in an opaque-origin sandboxed iframe. The preview
  // never proxies requests to Buildr's API runtime or to third-party hosts.
  // CSP below blocks network connections; this wrapper returns deterministic
  // mock responses for relative API calls so UI states can still be previewed.
  (function installPreviewFetch(){
    window.fetch = function(input, init){
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/') === 0 || url === '/api') {
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        var isRead = method === 'GET' || method === 'HEAD';
        // Reads answer with an empty LIST that also carries the usual wrapper keys
        // (data, items, results...), so generated code like setItems(await res.json())
        // or json.data.map(...) keeps working. Writes answer with a success object.
        var body = isRead
          ? Object.assign([], { data: [], items: [], results: [], rows: [], preview: true })
          : { ok: true, success: true, preview: true, data: {} };
        var res = new Response(isRead ? '[]' : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
        res.json = function(){ return Promise.resolve(body); };
        return Promise.resolve(res);
      }
      return Promise.reject(new Error('Network access is disabled in Buildr preview.'));
    };
  })();

  // ---- stub component for unknown imports -------------------------------
  function makeStubComponent(name){
    var C = function(props){
      if (props && props.children != null) {
        return React.createElement(React.Fragment, null, props.children);
      }
      return React.createElement('span', {
        'data-stub': String(name),
        style: { display:'inline-block', padding:'2px 8px', borderRadius:4, background:'#fde68a', color:'#92400e', fontSize:'0.75rem', fontFamily:'monospace' }
      }, String(name));
    };
    C.displayName = String(name);
    return C;
  }
  function makeStubModule(){
    return new Proxy({}, {
      get: function(_, name){
        if (name === '__esModule') return true;
        if (name === 'default') return makeStubComponent('default');
        return makeStubComponent(name);
      }
    });
  }

  // ---- integration / framework mocks ------------------------------------
  function makeSupabaseMock(){
    var q = {
      select: function(){ return q; },
      insert: function(){ return { select: function(){ return { single: function(){ return Promise.resolve({data:{},error:null}); } }; } }; },
      update: function(){ return { eq: function(){ return { select: function(){ return q; } }; } }; },
      delete: function(){ return { eq: function(){ return q; } }; },
      eq: function(){ return q; },
      neq: function(){ return q; },
      order: function(){ return q; },
      limit: function(){ return q; },
      single: function(){ return Promise.resolve({data:null,error:null}); },
      then: function(resolve){ resolve({data:[],error:null}); }
    };
    return {
      from: function(){ return q; },
      auth: {
        getUser: function(){ return Promise.resolve({data:{user:null},error:null}); },
        getSession: function(){ return Promise.resolve({data:{session:null},error:null}); },
        signInWithPassword: function(){ return Promise.resolve({data:{},error:null}); },
        signOut: function(){ return Promise.resolve({error:null}); }
      },
      storage: { from: function(){ return { upload: function(){ return Promise.resolve({data:{},error:null}); }, getPublicUrl: function(){ return {data:{publicUrl:''}}; } }; } }
    };
  }
  function makeStripeMock(){
    return new Proxy({}, {
      get: function(_, name){
        if (name === 'webhooks') return { constructEvent: function(){ return {type:'mock'}; } };
        return function(){ return Promise.resolve({ id:'mock_' + String(name) }); };
      }
    });
  }
  function makeLucideMock(){
    return new Proxy({}, {
      get: function(_, name){
        return makeStubComponent(String(name));
      }
    });
  }

  var MOCKS = {
    'react': function(){ return React; },
    'react-dom': function(){ return { createRoot: ReactDOMClient.createRoot }; },
    'react-dom/client': function(){ return { createRoot: function(el){ return ReactDOMClient.createRoot(el); } }; },
    'react/jsx-runtime': function(){ return { jsx: React.createElement, jsxs: React.createElement, Fragment: React.Fragment }; },
    'react/jsx-dev-runtime': function(){ return { jsxDEV: React.createElement, Fragment: React.Fragment }; },
    'lucide-react': function(){ return makeLucideMock(); },
    'clsx': function(){ return { clsx: function(){ var args=[]; for(var i=0;i<arguments.length;i++)args.push(arguments[i]); return args.flat(Infinity).filter(Boolean).join(' '); }, default: function(){ var args=[]; for(var i=0;i<arguments.length;i++)args.push(arguments[i]); return args.flat(Infinity).filter(Boolean).join(' '); } }; },
    'class-variance-authority': function(){ return { cva: function(base){ return function(){ return base; }; } }; },
    'tailwind-merge': function(){ return { twMerge: function(){ var args=[]; for(var i=0;i<arguments.length;i++)args.push(arguments[i]); return args.join(' '); } }; },
    'next/link': function(){ return { default: function(props){ return React.createElement('a', Object.assign({}, props, { href: props.href || '#' }), props.children); } }; },
    'next/image': function(){ return { default: function(props){ return React.createElement('img', props); } }; },
    'next/navigation': function(){ return { useRouter: function(){ return { push:function(){}, replace:function(){}, back:function(){}, refresh:function(){}, prefetch:function(){return Promise.resolve();} }; }, usePathname: function(){ return '/'; }, useSearchParams: function(){ return new URLSearchParams(); }, useParams: function(){ return {}; }, redirect: function(){}, notFound: function(){} }; },
    'next/headers': function(){ return { cookies: function(){ return { get:function(){return null;}, getAll:function(){return [];} }; }, headers: function(){ return new Map(); } }; },
    'next-auth/react': function(){ return { useSession: function(){ return [{ data:null, status:'unauthenticated' }, false]; }, signIn: function(){}, signOut: function(){}, SessionProvider: function(props){ return props.children; } }; },
    'next-auth': function(){ return { authOptions: {}, getServerSession: function(){ return Promise.resolve(null); } }; },
    'next/font/google': function(){ return new Proxy({}, { get: function(){ return { className:'', style:{}, variable:'' }; } }); },
    'next/font': function(){ return new Proxy({}, { get: function(){ return { className:'' }; } }); },
    '@supabase/supabase-js': function(){ return { createClient: function(){ return makeSupabaseMock(); } }; },
    'stripe': function(){ return { default: function(){ return makeStripeMock(); } }; },
    'resend': function(){ return { Resend: function(){ return { emails: { send: function(){ return Promise.resolve({ id:'mock' }); } } }; } }; },
    '@sendgrid/mail': function(){ return { default: { setApiKey: function(){}, send: function(){ return Promise.resolve([{}]); } } }; },
    'twilio': function(){ return { default: function(){ return { messages: { create: function(){ return Promise.resolve({ sid:'mock' }); } } }; } }; },
    'plaid': function(){ return { Configuration: function(){}, PlaidApi: function(){ return { linkTokenCreate: function(){ return Promise.resolve({ data:{} }); } }; }, PlaidEnvironments: { sandbox:{} } }; },
    'razorpay': function(){ return { default: function(){ return { orders: { create: function(){ return Promise.resolve({ id:'mock' }); } } }; } }; },
    '@clerk/nextjs': function(){ return { ClerkProvider: function(props){ return props.children; }, SignedIn: function(props){ return props.children; }, SignedOut: function(props){ return null; }, useUser: function(){ return { user:null, isLoaded:false }; }, useAuth: function(){ return { isSignedIn:false, userId:null }; }, SignIn: function(){ return React.createElement('div', null, 'SignIn'); }, SignUp: function(){ return React.createElement('div', null, 'SignUp'); } }; },
    '@clerk/nextjs/server': function(){ return { auth: function(){ return { userId:null }; } }; },
    'zod': function(){ return { z: new Proxy({}, { get: function(_, k){ return function(){ return { parse: function(v){return v;}, safeParse: function(v){return {success:true,data:v};}, optional: function(){return this;}, array: function(){return this;} }; }; } }) }; },
    '@hookform/resolvers/zod': function(){ return { zodResolver: function(){ return function(values){ return { values: values, errors: {} }; }; } }; },
    'react-hook-form': function(){ return { useForm: function(){ return { register: function(){ return {}; }, handleSubmit: function(fn){ return function(e){ if(e&&e.preventDefault)e.preventDefault(); fn({}); }; }, watch: function(){ return ''; }, setValue: function(){}, getValues: function(){ return {}; }, formState: { errors: {}, isSubmitting:false } }; }, FormProvider: function(props){ return props.children; } }; },
    'date-fns': function(){ return { formatDistanceToNow: function(){ return 'recently'; }, format: function(){ return ''; }, parseISO: function(v){ return new Date(v); } }; },
    'framer-motion': function(){ return { motion: new Proxy({}, { get: function(_,tag){ return React.createElement.bind(null, String(tag)); } }), AnimatePresence: function(props){ return props.children; } }; },
    'recharts': function(){ return new Proxy({}, { get: function(_, name){ return makeStubComponent(name); } }); },
    '@tanstack/react-query': function(){ return { useQuery: function(){ return { data:undefined, isLoading:false, error:null }; }, QueryClient: function(){ return {}; }, QueryClientProvider: function(props){ return props.children; } }; },
    'zustand': function(){ return { create: function(fn){ return function(){ return fn(function(){return {};}, function(){}); }; } }; },
    'uuid': function(){ return { v4: function(){ return 'mock-uuid'; }, v1: function(){ return 'mock-uuid'; } }; },
    'bcryptjs': function(){ return { compare: function(){ return Promise.resolve(true); }, hash: function(v){ return Promise.resolve('hashed:'+v); } }; }
  };

  // Integration-generated local lib shims (resolve via MOCKS by spec).
  function mockLocalLib(spec){
    if (spec === '@/lib/supabase') return { supabase: makeSupabaseMock() };
    if (spec === '@/lib/stripe') return { stripe: makeStripeMock() };
    if (spec === '@/lib/email') return { sendEmail: function(){ return Promise.resolve({id:'mock'}); } };
    if (spec === '@/lib/twilio') return { sendSms: function(){ return Promise.resolve({sid:'mock'}); } };
    if (spec === '@/lib/plaid') return { plaid: {} };
    if (spec === '@/lib/paystack') return { initialiseTransaction: function(){ return Promise.resolve({}); }, verifyTransaction: function(){ return Promise.resolve({}); } };
    if (spec === '@/lib/razorpay') return { razorpay: {}, createOrder: function(){ return Promise.resolve({}); } };
    if (spec === '@/lib/onfido') return { onfido: {}, createApplicant: function(){ return Promise.resolve({}); } };
    if (spec === '@/lib/auth') return { authOptions: {} };
    if (spec === '@/lib/clerk') return { ClerkProvider: function(p){return p.children;}, SignedIn:function(p){return p.children;}, SignedOut:function(){return null;} };
    return null;
  }

  function resolveLocal(spec, fromPath){
    var target = spec;
    if (target.indexOf('@/') === 0) {
      target = 'src/' + target.slice(2);
    } else if (target.indexOf('./') === 0 || target.indexOf('../') === 0) {
      var dir = fromPath.indexOf('/') >= 0 ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
      target = dir + '/' + spec;
      var parts = target.split('/');
      var out = [];
      for (var i=0;i<parts.length;i++){
        var p = parts[i];
        if (p === '.' || p === '') continue;
        if (p === '..') { out.pop(); continue; }
        out.push(p);
      }
      target = out.join('/');
    } else {
      return null;
    }
    var candidates = [target, target+'.tsx', target+'.ts', target+'.jsx', target+'.js', target+'/index.tsx', target+'/index.ts'];
    for (var c=0;c<candidates.length;c++){
      if (__availablePaths.indexOf(candidates[c]) >= 0) return candidates[c];
    }
    return null;
  }

  var __modules = {};

  function executeModule(path){
    if (__modules[path]) return __modules[path].exports;
    var mod = { exports: {} };
    __modules[path] = mod;
    var src = __sources[path];
    if (src == null) throw new Error('Module not found: ' + path);
    var transformed;
    try {
      transformed = Babel.transform(src, {
        presets: [ ['env', { modules: 'commonjs' }], ['react', { runtime: 'classic' }], 'typescript' ],
        filename: path,
        sourceMaps: 'inline'
      }).code;
    } catch (e) {
      throw new Error('Failed to transpile ' + path + ': ' + (e && e.message));
    }
    var localRequire = function(spec){ return __require(spec, path); };
    var factory = new Function('module','exports','require','React','ReactDOM', transformed);
    factory(mod, mod.exports, localRequire, React, ReactDOMClient);
    return mod.exports;
  }

  function __require(spec, fromPath){
    if (MOCKS[spec]) return MOCKS[spec]();
    var localLib = mockLocalLib(spec);
    if (localLib) return localLib;
    if (/\\.(css|scss|sass|svg|png|jpe?g|gif|webp|woff2?|ttf|ico)$/i.test(spec)) return {};
    if (spec.indexOf('./') === 0 || spec.indexOf('../') === 0 || spec.indexOf('@/') === 0) {
      var resolved = resolveLocal(spec, fromPath);
      if (resolved) {
        if (!__modules[resolved]) executeModule(resolved);
        return __modules[resolved].exports;
      }
    }
    return makeStubModule();
  }

  // ---- error boundary so render errors surface in the preview -----------
  var ErrorBoundary = (function(){
    function EB(props){ React.Component.call(this, props); this.state = { error: null }; }
    EB.prototype = Object.create(React.Component.prototype);
    EB.prototype.constructor = EB;
    EB.getDerivedStateFromError = function(error){ return { error: error }; };
    EB.prototype.componentDidCatch = function(error){ window.__buildrRuntimeState && (window.__buildrRuntimeState.renderError = (error && error.message) || String(error)); };
    EB.prototype.render = function(){
      if (this.state.error) {
        var msg = (this.state.error && (this.state.error.stack || this.state.error.message)) || String(this.state.error);
        return React.createElement('div', { style: { padding:'1rem', margin:'1rem', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', color:'#991b1b', fontFamily:'ui-sans-serif,system-ui' } },
          React.createElement('strong', null, 'Render error in component'),
          React.createElement('pre', { style: { margin:'0.5rem 0 0', padding:'0.75rem', background:'#fff', borderRadius:'6px', fontFamily:'ui-monospace,monospace', fontSize:'0.75rem', whiteSpace:'pre-wrap', wordBreak:'break-word', maxHeight:'280px', overflow:'auto' } }, msg)
        );
      }
      return this.props.children;
    };
    return EB;
  })();

  try {
    var entryExports = executeModule(__entry);
    var Component = entryExports.default || entryExports;
    if (typeof Component !== 'function' && typeof Component !== 'object') {
      throw new Error('Entry "' + __entry + '" does not export a React component.');
    }
    var root = ReactDOMClient.createRoot(document.getElementById('root'));
    root.render(React.createElement(ErrorBoundary, null, React.createElement(Component)));
  } catch (err) {
    showError(err);
  }
})();
`

// ---------------------------------------------------------------------------
// Static HTML path — already runnable, just inline CSS/JS.
// ---------------------------------------------------------------------------

function buildStaticHtml(files: PreviewFile[], projectName: string): string {
  const indexHtml = files.find((f) => f.path === 'index.html')
  const css = files.find((f) => f.path === 'styles.css')
  const js = files.find((f) => f.path === 'app.js')
  if (!indexHtml) return ''
  let html = indexHtml.content
  if (css) {
    html = html.replace(
      '<link rel="stylesheet" href="styles.css" />',
      `<style>${css.content}</style>`,
    )
  }
  if (js) {
    html = html.replace('<script src="app.js"></script>', `<script>${js.content}</script>`)
  }
  return html
}

// ---------------------------------------------------------------------------
// "No previewable UI" fallback.
// ---------------------------------------------------------------------------

function buildNoUiHtml(projectName: string, reason: string, files: PreviewFile[]): string {
  const fileList = files
    .slice(0, 20)
    .map((f) => `<li><code>${f.path}</code></li>`)
    .join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(projectName)} — Preview</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; color: #18181b; background: #fafafa; }
  .banner { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1.5rem; }
  .banner h2 { margin: 0 0 0.5rem; font-size: 1rem; color: #92400e; }
  ul { columns: 2; column-gap: 2rem; }
  code { font-family: ui-monospace, monospace; font-size: 0.8rem; color: #52525b; }
</style></head><body>
<div class="banner"><h2>Live preview unavailable</h2><p>${escapeHtml(reason)}</p></div>
<p>Project files:</p>
<ul>${fileList}</ul>
</body></html>`
}

// ---------------------------------------------------------------------------
// Expo (React Native) preview — shows a phone frame mockup with the app's
// first screen rendered as a static approximation. The full app requires
// the Expo dev server (run `expo start` locally).
// ---------------------------------------------------------------------------

function buildExpoPreview(projectName: string, _projectId: string, files: PreviewFile[]): string {
  // Try to find the index screen to extract text content for the mockup.
  const indexFile = files.find((f) => f.path === 'app/index.tsx' || f.path === 'App.tsx')
  let appTitle = projectName
  let appSubtitle = 'Built with React Native + Expo'

  if (indexFile) {
    // Extract title from the source (best effort).
    const titleMatch = indexFile.content.match(/style={styles\.title}[^>]*>([^<]+)/)
    if (titleMatch) appTitle = titleMatch[1].trim()
    const subtitleMatch = indexFile.content.match(/style={styles\.subtitle}[^>]*>([^<]+)/)
    if (subtitleMatch) appSubtitle = subtitleMatch[1].trim()
  }

  const fileList = files.slice(0, 15).map((f) => `<li><code>${f.path}</code></li>`).join('')

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(projectName)} — Expo Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f4f4f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .container { display: flex; gap: 3rem; align-items: flex-start; max-width: 900px; }
    .phone {
      width: 320px; height: 640px; border-radius: 40px; background: #000;
      padding: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.15);
      position: relative; flex-shrink: 0;
    }
    .screen {
      width: 100%; height: 100%; border-radius: 30px; background: #fff;
      overflow: hidden; display: flex; flex-direction: column;
    }
    .status-bar { height: 28px; background: #059669; display: flex; align-items: center; justify-content: center; }
    .status-bar span { color: #fff; font-size: 12px; font-weight: 600; }
    .app-content { flex: 1; padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .app-title { font-size: 24px; font-weight: 700; color: #0a0a0a; margin-bottom: 8px; }
    .app-subtitle { font-size: 14px; color: #059669; font-weight: 600; margin-bottom: 16px; }
    .app-button { background: #059669; color: #fff; padding: 12px 32px; border-radius: 12px; font-size: 14px; font-weight: 600; margin-top: 16px; }
    .notch { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); width: 120px; height: 24px; background: #000; border-radius: 0 0 16px 16px; z-index: 10; }
    .info { max-width: 400px; }
    .info h2 { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .info p { color: #71717a; font-size: 14px; line-height: 1.6; margin-bottom: 16px; }
    .info ul { list-style: none; margin-top: 16px; }
    .info li { padding: 4px 0; font-family: ui-monospace, monospace; font-size: 12px; color: #52525b; }
    .badge { display: inline-block; background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 16px; }
    @media (max-width: 768px) { .container { flex-direction: column; } .phone { transform: scale(0.85); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="phone">
      <div class="notch"></div>
      <div class="screen">
        <div class="status-bar"><span>${escapeHtml(projectName)}</span></div>
        <div class="app-content">
          <div class="app-title">${escapeHtml(appTitle)}</div>
          <div class="app-subtitle">${escapeHtml(appSubtitle)}</div>
          <div class="app-button">Get Started</div>
        </div>
      </div>
    </div>
    <div class="info">
      <span class="badge">📱 React Native + Expo</span>
      <h2>${escapeHtml(projectName)}</h2>
      <p>This is an Expo (React Native) project. The preview shows an approximation of the first screen. To run the full app on a device or simulator:</p>
      <p><code>npm install && npx expo start</code></p>
      <p>Then scan the QR code with the Expo Go app (iOS/Android) or press <code>i</code> for iOS simulator / <code>a</code> for Android emulator.</p>
      <ul>${fileList}</ul>
    </div>
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// React/Next.js interactive preview HTML.
// ---------------------------------------------------------------------------

function buildReactHtml(
  projectName: string,
  projectId: string,
  sources: Map<string, string>,
  entryPath: string,
  availablePaths: string[],
  customCss: string,
): string {
  const sourcesJson = JSON.stringify(Object.fromEntries(sources))
  const availableJson = JSON.stringify(availablePaths)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(projectName)} — Live Preview</title>
  <script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"></script>
  <script src="https://unpkg.com/@babel/standalone@7.25.6/babel.min.js"></script>
  <script src="https://cdn.tailwindcss.com?plugins=forms,typography"></script>
  <style>
    :root { color-scheme: light; }
    html, body { margin: 0; padding: 0; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #ffffff; color: #0a0a0a; }
    #root { min-height: 100vh; }
    #__preview-banner {
      position: sticky; top: 0; z-index: 50;
      background: linear-gradient(90deg, #ecfdf5, #f0fdfa);
      border-bottom: 1px solid #a7f3d0;
      padding: 0.4rem 1rem;
      font-size: 0.72rem;
      color: #047857;
      display: flex; align-items: center; gap: 0.4rem;
    }
    #__preview-banner::before { content: "●"; color: #10b981; font-size: 0.6rem; }
    #__preview-error {
      display: none;
      margin: 1rem; padding: 1rem 1.25rem;
      background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
      color: #991b1b; font-family: ui-sans-serif, system-ui, sans-serif;
    }
    #__preview-error pre {
      margin: 0.5rem 0 0; padding: 0.75rem;
      background: #fff; border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, monospace; font-size: 0.75rem;
      white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow: auto;
    }
    ${customCss}
  </style>
</head>
<body>
  <div id="__preview-banner">Live interactive preview · client-rendered · API routes &amp; DB calls stubbed. Export &amp; run locally for the full-stack runtime.</div>
  <div id="__preview-error"></div>
  <div id="root"></div>
  <script>
    var __sources = ${sourcesJson};
    var __entry = ${JSON.stringify(entryPath)};
    var __availablePaths = ${availableJson};
    var __buildrProjectId = ${JSON.stringify(projectId)};
  </script>
  <script>${RUNTIME_JS}</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ---------------------------------------------------------------------------
// Public entry.
// ---------------------------------------------------------------------------

export function buildInteractivePreview(
  projectName: string,
  projectId: string,
  stack: StackKey,
  files: PreviewFile[],
): PreviewBundleResult {
  // Static HTML stack — already runnable, inline its assets.
  if (stack === 'static-html') {
    const html = buildStaticHtml(files, projectName)
    if (html) return { html, mode: 'static' }
    return {
      html: buildNoUiHtml(projectName, 'No index.html found for this static project.', files),
      mode: 'none',
    }
  }

  // Express / API-only — no client UI to preview.
  if (stack === 'node-express') {
    return {
      html: buildNoUiHtml(
        projectName,
        'This is a Node/Express backend project — it has no client UI to preview. Export the ZIP and run npm install && npm run dev to start the API server.',
        files,
      ),
      mode: 'none',
    }
  }

  // Expo (React Native) — no web preview. Show a mobile-frame mockup.
  if (stack === 'react-vite' as string) {
    return {
      html: buildExpoPreview(projectName, projectId, files),
      mode: 'none',
    }
  }

  // React-based stacks — build the live interactive runtime.
  const entry = findEntry(files, stack)
  if (!entry) {
    return {
      html: buildNoUiHtml(
        projectName,
        'No page component (e.g. src/app/page.tsx or src/App.tsx) was found to preview. Generate a UI first via chat.',
        files,
      ),
      mode: 'none',
    }
  }

  const allFiles = new Map(files.map((f) => [f.path, f]))
  const sources = collectDeps(entry, allFiles)
  const availablePaths = files.map((f) => f.path)
  const customCss = extractCustomCss(files)

  return {
    html: buildReactHtml(projectName, projectId, sources, entry.path, availablePaths, customCss),
    mode: 'react',
  }
}
