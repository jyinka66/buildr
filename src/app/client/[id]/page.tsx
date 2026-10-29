'use client'

import { useEffect, useMemo, useState } from 'react'

type PortalData = {
  job: {
    title: string
    description: string
    jobType: string
    status: string
    clientName: string | null
    budget: number | string | null
    createdAt: string
  }
  scope: {
    summary?: string
    stack?: string[] | string
    estimatedHours?: number
    complexity?: string
    deliverables?: unknown[]
    features?: unknown[]
    pages?: unknown[]
    integrations?: unknown[]
  }
  tasks: Array<{ id?: string; name?: string; description?: string; status?: string; estimatedMinutes?: number }>
  deliverables: Array<{ type?: string; name?: string; path?: string; url?: string }>
  projectId: string | null
}

function humanize(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function ClientPortalPage({ params }: { params: Promise<{ id: string }> }) {
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const resolved = await params
        const search = new URLSearchParams(window.location.search)
        const shareToken = search.get('token') || ''
        if (!active) return
        if (!shareToken) {
          setError('This client portal link is missing its access token. Ask the project owner for a new link.')
          setLoading(false)
          return
        }
        const response = await fetch(`/api/jobs/${encodeURIComponent(resolved.id)}/client-portal?token=${encodeURIComponent(shareToken)}`, {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(response.status === 403 ? 'This client portal link is invalid or has been revoked.' : (result.error || 'Unable to load the client portal.'))
        if (active) setData(result as PortalData)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load the client portal.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [params])

  const completedTasks = useMemo(() => data?.tasks.filter((task) => task.status === 'completed').length ?? 0, [data])
  const progress = data?.tasks.length ? Math.round((completedTasks / data.tasks.length) * 100) : 0

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6">
      <meta name="referrer" content="no-referrer" />
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">Buildr · Client Portal</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">A private project progress view</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Shared access</span>
        </header>

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 dark:border-slate-800 dark:bg-slate-900" aria-live="polite">
            <div className="animate-pulse space-y-4"><div className="h-6 w-2/3 rounded bg-slate-200 dark:bg-slate-700"/><div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800"/><div className="h-24 rounded bg-slate-100 dark:bg-slate-800"/></div>
            <p className="mt-4 text-sm text-slate-500">Loading project details…</p>
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-rose-200 bg-white p-8 dark:border-rose-900 dark:bg-slate-900" role="alert">
            <h1 className="text-xl font-semibold">Portal unavailable</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{error}</p>
          </section>
        ) : data ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <p className="text-sm text-slate-500 dark:text-slate-400">{data.job.clientName ? `Prepared for ${data.job.clientName}` : 'Project overview'}</p>
                  <h1 className="mt-2 text-3xl font-semibold tracking-tight">{data.job.title}</h1>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{data.job.description}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium dark:bg-slate-800">{humanize(data.job.status)}</span>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70"><p className="text-xs text-slate-500">Project type</p><p className="mt-1 font-medium">{humanize(data.job.jobType || 'project')}</p></div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70"><p className="text-xs text-slate-500">Started</p><p className="mt-1 font-medium">{Number.isNaN(Date.parse(data.job.createdAt)) ? '—' : new Date(data.job.createdAt).toLocaleDateString()}</p></div>
                <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70"><p className="text-xs text-slate-500">Tasks completed</p><p className="mt-1 font-medium">{completedTasks} of {data.tasks.length}</p></div>
              </div>
              {data.tasks.length > 0 && <div className="mt-5"><div className="mb-2 flex justify-between text-xs text-slate-500"><span>Overall task progress</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }}/></div></div>}
            </section>

            {data.scope.summary && <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-lg font-semibold">Scope summary</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{data.scope.summary}</p></section>}

            <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold">Tasks and milestones</h2>
              {data.tasks.length ? <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">{data.tasks.map((task, index) => <li key={task.id || `${task.name || 'task'}-${index}`} className="flex items-start gap-3 py-4"><span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${task.status === 'completed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'}`}>{task.status === 'completed' ? '✓' : index + 1}</span><div className="min-w-0 flex-1"><p className="font-medium">{task.name || `Task ${index + 1}`}</p>{task.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{task.description}</p>}</div><span className="shrink-0 text-xs text-slate-500">{humanize(task.status || 'pending')}</span></li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No tasks have been added yet.</p>}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold">Deliverables</h2>
              {data.deliverables.length ? <ul className="mt-4 space-y-3">{data.deliverables.map((item, index) => <li key={`${item.url || item.path || item.name || 'deliverable'}-${index}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 p-4 dark:border-slate-800"><div><p className="font-medium">{item.name || item.path || `Deliverable ${index + 1}`}</p>{item.type && <p className="mt-1 text-xs text-slate-500">{humanize(item.type)}</p>}</div>{item.url && <a className="text-sm font-medium text-emerald-700 underline underline-offset-4 dark:text-emerald-400" href={item.url} target="_blank" rel="noopener noreferrer">Open deliverable</a>}</li>)}</ul> : <p className="mt-3 text-sm text-slate-500">No deliverables have been shared yet.</p>}
            </section>
          </>
        ) : null}
        <footer className="pb-6 text-center text-xs text-slate-500">This page is available to anyone holding the share link. If you received it unexpectedly, you can close this page.</footer>
      </div>
    </main>
  )
}
