// Where the platforms send the user back after they approve access.
// Each URL must be registered exactly as returned here in that platform's developer console.

export function appOrigin(env: Record<string, string | undefined>, requestOrigin: string): string {
  const configured = env.NEXTAUTH_URL?.trim()
  if (configured) return new URL(configured).origin
  // NextAuth already refuses to run in production without NEXTAUTH_URL, so this is dev only.
  return requestOrigin
}

export function callbackUrl(env: Record<string, string | undefined>, requestOrigin: string, platform: string): string {
  return `${appOrigin(env, requestOrigin)}/api/marketing/accounts/oauth/${platform}/callback`
}
