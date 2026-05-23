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

/**
 * Formatuje długość ze sceny (zawsze przechowywaną w metrach) na display
 * wg user-selected lengthUnit z useViewer store.
 *
 *   - 'm'  → 1.05 m (precyzja 2 miejsca dziesiętne)
 *   - 'cm' → 105 cm (precyzja całkowita)
 *   - 'mm' → 1050 mm (precyzja całkowita)
 */
export function formatLength(meters: number, lengthUnit: 'm' | 'cm' | 'mm'): string {
  if (lengthUnit === 'mm') return `${Math.round(meters * 1000)} mm`
  if (lengthUnit === 'cm') return `${Math.round(meters * 100)} cm`
  return `${Number.parseFloat(meters.toFixed(2))} m`
}
