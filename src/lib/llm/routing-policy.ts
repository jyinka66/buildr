// Pure routing policy shared by normal and streaming completions.
// A provider is routable only when enabled, not marked offline, and configured.
// Every hosted provider requires a real server-side credential.
export interface RoutingProvider {
  id: string
  key: string
  enabled: boolean
  health: string
  apiKey: string
  weight: number
  speciality: string
}

export function isProviderReady(provider: RoutingProvider): boolean {
  if (!provider.enabled || provider.health === 'down') return false
  const key = provider.apiKey.trim()
  return key.length > 0 && key !== '(managed)'
}

export function rankProviders<T extends RoutingProvider>(
  providers: T[],
  task: string,
  overrideKey?: string | null,
): T[] {
  const eligible = providers.filter(isProviderReady)
  const ranked: T[] = []
  const add = (items: T[]) => {
    for (const provider of items) {
      if (!ranked.some((existing) => existing.id === provider.id)) ranked.push(provider)
    }
  }
  const byWeight = (a: T, b: T) => b.weight - a.weight

  if (overrideKey) {
    add(eligible.filter((provider) => provider.key === overrideKey))
  }
  add(eligible.filter((provider) => provider.speciality === task).sort(byWeight))
  add(eligible.filter((provider) => provider.speciality === 'general').sort(byWeight))
  // Remaining configured providers are failover candidates, ordered by weight.
  add(eligible.slice().sort(byWeight))
  return ranked
}
