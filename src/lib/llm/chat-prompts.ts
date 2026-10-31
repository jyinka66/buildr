// System prompts for conversational chat (Buildr's "talk to the AI" mode).
//
// Chat is separate from code generation on purpose: code generation keeps its
// strict "emit files only" prompt in code-generator.ts. In a project chat the
// model answers conversationally, and when the user clearly wants the app
// changed it replies with BUILD_MARKER so the client can hand the request to
// the existing build pipeline (generate-stream) unchanged.

export const BUILD_MARKER = '[[BUILD]]'

// Decides, from the first characters of a reply, whether the model is handing
// the request to the builder. 'wait' = too early to tell (could still become
// the marker), 'build' = it is the marker, 'chat' = a normal answer.
export function classifyReplyHead(head: string): 'wait' | 'build' | 'chat' {
  const t = head.trimStart()
  if (t.startsWith(BUILD_MARKER)) return 'build'
  if (t.length < BUILD_MARKER.length && BUILD_MARKER.startsWith(t)) return 'wait'
  return 'chat'
}

const CORE = [
  'You are Buildr AI, a capable, friendly assistant inside Buildr, a platform for building and launching web apps and businesses.',
  'You can talk about anything: answer questions, explain concepts, brainstorm, plan, debug, review ideas, and write or explain code.',
  'Think before answering when a question needs it, then reply clearly and directly.',
  'Use Markdown. Put code in fenced blocks with a language tag. Keep answers as short as the question allows; go deeper when asked.',
  'For larger goals, work like a thoughtful collaborator: clarify what matters, propose a short step-by-step plan, then offer to start.',
  'Be honest about uncertainty and never invent facts, files, or results.',
]

export interface ProjectChatContext {
  name: string
  stack: string
  styling: string
  files: string[]
  /** Current code of the most relevant files, already formatted (see project-context.ts). */
  code?: string
}

export function buildChatSystemPrompt(project?: ProjectChatContext | null, allowBuild = true): string {
  if (!project) {
    return [
      ...CORE,
      '',
      'No project is open right now, so you cannot create or edit files in this conversation.',
      'If the user wants to build an app, help them shape the idea and plan, then tell them they can create a project in Buildr to have it built.',
    ].join('\n')
  }

  const files = project.files.slice(0, 60).map((f) => `- ${f}`).join('\n') || '(no files yet)'
  const lines = [
    ...CORE,
    '',
    `The user is working in the project "${project.name}" (stack: ${project.stack}, styling: ${project.styling}).`,
    'Files currently in the project:',
    files,
    '',
    'You can discuss, explain, and plan changes to this project in conversation.',
  ]

  if (project.code) {
    lines.push(
      '',
      'Current code of the most relevant files (this is the real source; base your answers about the app on it):',
      project.code,
      '',
      'If you need a file whose content is not shown above, say so and ask the user to paste it. Never guess what it contains.',
    )
  }

  if (allowBuild) {
    lines.push(
      '',
      'DECIDING WHEN TO BUILD:',
      `If, and only if, the user is clearly asking you to create, add, change, fix, or remove something in the app's code or files right now, reply with exactly ${BUILD_MARKER} and nothing else. A separate builder will then do the work.`,
      'Do NOT use it for questions, explanations, brainstorming, planning, comparisons, or when the user is only asking for your opinion or a plan. For those, answer normally.',
      `Never write ${BUILD_MARKER} anywhere except as the entire reply.`,
    )
  } else {
    lines.push(
      '',
      'You cannot edit files in this mode. If the user wants changes made, explain what you would change and tell them to switch to Build mode so the builder can apply it.',
    )
  }
  return lines.join('\n')
}
