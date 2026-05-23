/**
 * GSI Platform fork — PL helpers.
 *
 * Pascal default names używają `Level ${n}` template literals. W PL chcemy:
 *   - poziom 0 → Parter
 *   - poziom > 0 → Piętro 1, Piętro 2, ...
 *   - poziom < 0 → Piwnica (lub Piwnica 2 dla wielu)
 */

export function formatLevelName(level: number): string {
  if (level === 0) return 'Parter'
  if (level > 0) return `Piętro ${level}`
  const depth = -level
  return depth === 1 ? 'Piwnica' : `Piwnica ${depth}`
}
