// Error text that is safe to show a regular user.
//
// Upstream failures arrive as strings like "Groq stream error 429: {...}" or "No AI provider is
// configured. Add a provider API key in Settings → LLM Providers." They name the vendor, the
// status and sometimes the raw response. Which AI models Buildr uses is internal, so regular users
// get a generic message instead. Admins still see the full text so they can fix the cause.
//
// Pure and dependency free so it runs under plain `node --test`.

export const GENERIC_AI_ERROR = 'The AI service is having trouble right now. Please try again in a moment.'

const PROVIDER_ERROR =
  /\b(groq|openrouter|anthropic|claude|openai|gpt|gemini|google|deepseek|ollama|z\.ai|llm|provider|api key|stream error|completion)\b|\berror \d{3}\b|settings\s*(→|->)/i

export function publicErrorMessage(message: string, isAdmin: boolean): string {
  if (isAdmin) return message
  return PROVIDER_ERROR.test(message) ? GENERIC_AI_ERROR : message
}
