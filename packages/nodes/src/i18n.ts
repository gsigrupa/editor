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

export function formatLength(meters: number, lengthUnit: 'm' | 'cm' | 'mm'): string {
  if (lengthUnit === 'mm') return `${Math.round(meters * 1000)} mm`
  if (lengthUnit === 'cm') return `${Math.round(meters * 100)} cm`
  return `${Number.parseFloat(meters.toFixed(2))} m`
}
