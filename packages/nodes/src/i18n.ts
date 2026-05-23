/**
 * GSI Platform fork — PL helpers dla packages/nodes (kopia z packages/editor/src/lib/i18n.ts).
 * Nie da się importować cross-package bez dodawania peer dep — duplicate jest najszybsze.
 */

export function formatLevelName(level: number): string {
  if (level === 0) return 'Parter'
  if (level > 0) return `Piętro ${level}`
  const depth = -level
  return depth === 1 ? 'Piwnica' : `Piwnica ${depth}`
}
