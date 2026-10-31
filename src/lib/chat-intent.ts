// Fast, local routing for the builder chat. Clear build commands skip the
// extra "should I build?" model call (the main cause of slow replies); clear
// questions go straight to chat; anything unclear is left to the AI.
// Pure function, no I/O.

export type ChatIntent = 'build' | 'chat' | 'unsure'

const BUILD_VERBS =
  'add|create|build|make|implement|generate|insert|include|integrate|connect|set up|setup|install|' +
  'change|update|modify|edit|replace|rename|move|remove|delete|fix|refactor|redesign|restyle|style|' +
  'improve|optimi[sz]e|convert|translate|rewrite|swap|switch|hide|show|display|enable|disable|wire|' +
  'put|turn|adjust|center|align|resize|animate|style|paginate|validate|secure|deploy'

const BUILD_START = new RegExp(`^(?:(?:please|pls|now|then|also|and|can you|could you|would you|will you|i want you to|i want to|i need you to|i need to|go ahead and|let'?s|lets)\\s+)*(?:${BUILD_VERBS})\\b`, 'i')

const QUESTION_START =
  /^(?:what|why|how|when|where|who|which|is|are|do|does|did|should|could|would|can|will|explain|describe|tell me|show me how|walk me through|compare|summari[sz]e|review|list|help me understand|give me (?:an? )?(?:idea|overview|summary|plan|opinion))\b/i

export function classifyIntent(raw: string): ChatIntent {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return 'unsure'

  const asksPermission = /^(?:can|could|would|will) you\b/i.test(text)
  // "Can you add a login page?" is a build request; "can you explain X?" is chat.
  if (asksPermission && BUILD_START.test(text)) return 'build'

  if (QUESTION_START.test(text)) return 'chat'
  if (text.endsWith('?')) return 'chat'

  // Short imperative that begins with a build verb.
  if (BUILD_START.test(text)) return 'build'

  return 'unsure'
}
