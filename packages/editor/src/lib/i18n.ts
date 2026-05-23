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

/**
 * Polski plural dla rzeczowników: 1 segment / 2-4 segmenty / 5+ segmentów.
 * Pattern: forma singularna + dwa pluralne (minor: 2-4 + major: 5+).
 *
 * Specjalny case: liczby 12-14 idą do major plural (segmentów),
 * niezależnie od końcówki dziesiątek.
 */
function pluralPl(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Format "1 segment", "3 segmenty", "5 segmentów". */
export function formatSegmentCount(n: number): string {
  return `${n} ${pluralPl(n, 'segment', 'segmenty', 'segmentów')}`
}

/** Map enum roofType (Pascal core) na PL display name. */
export function formatRoofType(roofType: string): string {
  const map: Record<string, string> = {
    hip: 'Kopertowy',
    gable: 'Dwuspadowy',
    shed: 'Pulpitowy',
    gambrel: 'Mansardowy łamany',
    dutch: 'Półszczytowy',
    mansard: 'Mansardowy',
    flat: 'Płaski',
  }
  return map[roofType] ?? roofType
}

/** Stair segment types (flight = bieg, landing = spocznik). */
export function formatStairSegmentType(segmentType: 'stair' | 'landing'): string {
  return segmentType === 'stair' ? 'Bieg' : 'Spocznik'
}
