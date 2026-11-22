// Migrate persisted renderer store keys from legacy Akumy Music branding to Kaze
const MIGRATIONS: [string, string][] = [
  ['akumy-settings', 'kaze-settings'],
  ['akumy-user', 'kaze-user'],
  ['akumy-player', 'kaze-player']
]

try {
  for (const [legacyKey, nextKey] of MIGRATIONS) {
    if (!localStorage.getItem(nextKey)) {
      const legacyVal = localStorage.getItem(legacyKey)
      if (legacyVal !== null) {
        localStorage.setItem(nextKey, legacyVal)
      }
    }
  }
} catch {
  // Ignore storage restrictions
}
