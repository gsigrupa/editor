'use client'

/**
 * GSI fork — SketchUp-accurate Tape Measure tool ("T" key).
 *
 * Pełna implementacja zgodna z SketchUp UX spec (research 2026-05-24).
 * Sources: help.sketchup.com, sketchucation.com Complete Guide.
 *
 * **MODY (Ctrl toggle, single press = flip):**
 * - **Guide Create** (default): kursor + czerwone `+`. Tworzy guide line
 *   lub guide point zależnie od TYPU pierwszego clicka.
 * - **Measure only**: kursor bez `+`. Mierzy bez tworzenia geometrii.
 *
 * **PIERWSZY KLIK okreśła co powstanie:**
 * - Endpoint (corner) / guide point / origin → **guide point** na 2-gi klik
 * - On Edge (mid-edge) / wall / axis → **infinite guide line** równoległa
 *   do source edge, offset = perpendicular distance
 * - Empty space / floor → guide point w pozycji projektowanej
 *
 * **INFERENCE (drag po 1-szym klik):**
 * - Axis X (red) / Z (blue) / Y (green) od origin
 * - (Future: Parallel/Perpendicular do source edge — magenta)
 *
 * **SNAP MARKERS** (kolory wg SketchUp):
 * - Endpoint = zielone kółko
 * - Midpoint = cyan kółko
 * - On Edge = czerwony kwadrat
 * - On Axis = kolor osi (R/G/B)
 * - Origin = żółte kółko
 *
 * **KLAWISZE:**
 * - Esc: DRAGGING → cancel drag, stay in tool. IDLE → exit tool.
 * - Ctrl/Meta: toggle mode
 * - Y: clear all guides + measurements (Pascal extension)
 * - 0-9, ., Enter, Backspace: numeric input
 *
 * **PERSYSTENCJA:** module-scope store (przetrwa tool switch). Full DB
 * persistence = osobny task.
 */

import { emitter, type GridEvent, type LevelNode, type SiteNode, type WallNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
// Relative imports — plik wewnątrz pakietu editor.
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { snapWallDraftPoint } from '../wall/wall-drafting'

// ──────────────────────────────────────────────────────────────────────
// CONSTANTS

const SNAP_RADIUS_POINT = 0.4 // 40cm dla snap'ów punktowych (endpoint/midpoint/origin)
const SNAP_RADIUS_LINE = 0.5 // 50cm dla snap'ów liniowych (on-edge/on-axis)
const AXIS_INFERENCE_THRESHOLD = 0.25 // 25cm — drag cursor blisko axis → snap
const LINE_THICKNESS = 0.01 // 10mm
// Długość 200m — guide centrowany na refOrigin (np rogu działki); 100m
// w każdą stronę musi pokryć typową działkę 30×30 z dużym zapasem żeby
// linia wyglądała na infinite.
const GUIDE_LINE_LENGTH = 200 // m — infinite-ish dla guide lines
// 6cm dash + 6cm gap = ~6px na typowym zoomie kamery (50px/m).
const DASH_PERIOD = 0.12 // m
const DASH_RATIO = 0.5
const DASH_SEGMENTS = Math.floor(GUIDE_LINE_LENGTH / DASH_PERIOD)
const HUD_OFFSET = 0.02
const POINT_MARKER_SIZE = 14 // px screen-space dla snap markers
// Marker elevation — wallowe snap'y są w centerline (oś środkowa) na poziomie
// podłogi y=0. Mesh ściany sterczy do ~2.7m, więc marker na y=0 wygląda
// percepcyjnie jakby był „za" widoczną elewacją front-face. Podnosimy go
// do 1m + dorysowujemy pionowy stem od podłogi do markera (SketchUp-style
// inference extension), żeby user widział gdzie geometrycznie jest snap.
const SNAP_MARKER_ELEVATION = 1.0
const SNAP_STEM_THICKNESS = 0.006

// SketchUp axis colors
const COLOR_X = '#ef4444' // red-500
const COLOR_Y = '#22c55e' // green-500
const COLOR_Z = '#3b82f6' // blue-500
const COLOR_ENDPOINT = '#22c55e' // green
const COLOR_MIDPOINT = '#06b6d4' // cyan-500
const COLOR_ON_EDGE = '#ef4444' // red square
const COLOR_ORIGIN = '#eab308' // yellow-500
const COLOR_WALL_GUIDE = '#a855f7' // purple dla wall reference guide
const COLOR_AXIS_GUIDE = '#0f172a' // czarny dla guide wyciągniętego z osi (Photoshop/Illustrator style)
const COLOR_MEASURE_FREE = '#6b7280' // gray-500 dla free drag (brak inference)
const SHADOW = '#ffffff'

// ──────────────────────────────────────────────────────────────────────
// TYPES

type Phase = 'idle' | 'dragging'
type SnapType = 'endpoint' | 'midpoint' | 'on-edge' | 'on-axis-x' | 'on-axis-y' | 'on-axis-z' | 'origin' | 'guide-point' | 'on-guide-line' | 'measurement-endpoint' | 'empty'
type DeletableKind = 'guide-line' | 'guide-point' | 'measurement'
type OriginType = 'point' | 'edge' | 'empty'
type AxisInferenceType = 'x' | 'y' | 'z'

interface MeasurePoint {
  x: number
  z: number
  y: number
}

/** Snap result — co cursor wykrył pod sobą. */
interface SnapResult {
  type: SnapType
  point: MeasurePoint
  label: string // tooltip text
  color: string // marker color
  /** Reference line (gdy snap = on-edge / on-axis). Origin + direction w XZ. */
  reference?: { origin: [number, number]; direction: [number, number] }
  /** Gdy snap to istniejący element store'a — id + kind do usunięcia przez Delete. */
  deletable?: { kind: DeletableKind; id: string }
}

/** Axis inference during drag — cursor snapped do osi X/Y/Z od origin. */
interface AxisInference {
  axis: AxisInferenceType
  snappedPoint: MeasurePoint
  color: string
}

/** Persystentny guide line (infinite parallel do reference). */
interface GuideLine {
  id: string
  refOrigin: [number, number]
  refDirection: [number, number]
  perpOffset: number // signed
  y: number
  color: string
  label: string
}

/** Persystentny guide point. */
interface GuidePoint {
  id: string
  position: MeasurePoint
  label: string
}

/** Persystentny pomiar point-to-point. */
interface MeasurementSegment {
  id: string
  start: MeasurePoint
  end: MeasurePoint
  label: string
}

// ──────────────────────────────────────────────────────────────────────
// MODULE-SCOPE STORE — przetrwa MeasureTool unmount przy tool switch.
// Pełna DB persystencja = osobny task.

const moduleGuideLines: GuideLine[] = []
const moduleGuidePoints: GuidePoint[] = []
const moduleMeasurements: MeasurementSegment[] = []
const measureSubscribers = new Set<() => void>()

function notifyMeasureChange() {
  for (const cb of measureSubscribers) cb()
}

// ──────────────────────────────────────────────────────────────────────
// HELPERS

function getSiteCorner(): [number, number] {
  // Lewy-tylny róg działki (min X, min Z z polygon points) — analog scene-axes.tsx.
  // Snap on-axis-x/y/z odwołuje się do osi działki, nie do globalnego (0,0).
  const { nodes, rootNodeIds } = useScene.getState()
  const rootId = rootNodeIds[0]
  if (!rootId) return [0, 0]
  const node = nodes[rootId]
  if (!node || node.type !== 'site') return [0, 0]
  const points = (node as SiteNode).polygon?.points
  const first = points?.[0]
  if (!points || points.length === 0 || !first) return [0, 0]
  let minX = first[0]
  let minZ = first[1]
  for (const [x, z] of points) {
    if (x < minX) minX = x
    if (z < minZ) minZ = z
  }
  return [minX, minZ]
}

function getCurrentLevelWalls(): WallNode[] {
  // Pascal hierarchy: level.children[] zawiera ID-y wszystkich ścian na tym
  // poziomie (analog wall/tool.tsx getCurrentLevelWalls).
  const currentLevelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!currentLevelId) return []
  const levelNode = nodes[currentLevelId]
  if (!levelNode || levelNode.type !== 'level') return []
  return (levelNode as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

function formatLength(meters: number): string {
  const lengthUnit = useViewer.getState().lengthUnit
  if (lengthUnit === 'cm') return `${(meters * 100).toFixed(1)} cm`
  if (lengthUnit === 'mm') return `${(meters * 1000).toFixed(0)} mm`
  return `${meters.toFixed(2)} m`
}

function parsePendingLengthToMeters(pending: string): number | null {
  const trimmed = pending.replace(',', '.').trim()
  if (trimmed === '' || trimmed === '.') return null
  const value = Number.parseFloat(trimmed)
  if (!Number.isFinite(value) || value <= 0) return null
  const lengthUnit = useViewer.getState().lengthUnit
  if (lengthUnit === 'cm') return value / 100
  if (lengthUnit === 'mm') return value / 1000
  return value
}

function pointDistance2D(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function pointToSegmentDistance2D(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): { distance: number; t: number; projection: [number, number] } {
  const dx = segEnd[0] - segStart[0]
  const dz = segEnd[1] - segStart[1]
  const lenSq = dx * dx + dz * dz
  if (lenSq < 1e-9) return { distance: pointDistance2D(point, segStart), t: 0, projection: segStart }
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dz) / lenSq),
  )
  const projX = segStart[0] + t * dx
  const projZ = segStart[1] + t * dz
  return {
    distance: Math.hypot(point[0] - projX, point[1] - projZ),
    t,
    projection: [projX, projZ],
  }
}

/**
 * Signed perpendicular distance od cursora do reference line.
 * Positive sign = lewa strona (perpDir convention = -direction.z, direction.x).
 */
function signedPerpDistance(
  cursor: [number, number],
  ref: { origin: [number, number]; direction: [number, number] },
): number {
  const dx = cursor[0] - ref.origin[0]
  const dz = cursor[1] - ref.origin[1]
  const perpDirX = -ref.direction[1]
  const perpDirZ = ref.direction[0]
  return dx * perpDirX + dz * perpDirZ
}

// ──────────────────────────────────────────────────────────────────────
// SNAP DETECTION

/**
 * Detect najlepszy snap dla cursora. Priority order (SketchUp):
 * 1. Origin (0,0,0)
 * 2. Endpoint / Guide Point (corners + persisted guide points)
 * 3. Midpoint (środki ścian)
 * 4. On Edge (rzut na ścianę) / On Guide Line
 * 5. On Axis X / Z (cursor blisko osi)
 *
 * Returns SnapResult. Nigdy null — gdy nic w pobliżu zwraca `empty` (free
 * space click w pozycji raw cursor).
 */
function detectSnap(
  rawCursor: MeasurePoint,
  walls: WallNode[],
  guidePoints: GuidePoint[],
  guideLines: GuideLine[],
  measurements: MeasurementSegment[] = [],
  siteCorner: [number, number] = [0, 0],
): SnapResult {
  const point: [number, number] = [rawCursor.x, rawCursor.z]

  // 1. Origin (0,0,0)
  if (pointDistance2D(point, [0, 0]) < SNAP_RADIUS_POINT) {
    return {
      type: 'origin',
      point: { x: 0, y: 0, z: 0 },
      label: 'Origin',
      color: COLOR_ORIGIN,
    }
  }

  // 2. Guide points
  for (const gp of guidePoints) {
    if (pointDistance2D(point, [gp.position.x, gp.position.z]) < SNAP_RADIUS_POINT) {
      return {
        type: 'guide-point',
        point: gp.position,
        label: 'Guide Point · Del = usuń',
        color: COLOR_ENDPOINT,
        deletable: { kind: 'guide-point', id: gp.id },
      }
    }
  }

  // 2b. Measurement endpoints (segmenty z trybu MEASURE)
  for (const m of measurements) {
    for (const ep of [m.start, m.end]) {
      if (pointDistance2D(point, [ep.x, ep.z]) < SNAP_RADIUS_POINT) {
        return {
          type: 'measurement-endpoint',
          point: ep,
          label: 'Pomiar · Del = usuń',
          color: COLOR_ENDPOINT,
          deletable: { kind: 'measurement', id: m.id },
        }
      }
    }
  }

  // 3. Wall endpoints (corners)
  let bestEndpoint: { dist: number; p: MeasurePoint } | null = null
  for (const wall of walls) {
    for (const ep of [wall.start, wall.end]) {
      const d = pointDistance2D(point, ep)
      if (d < SNAP_RADIUS_POINT && (!bestEndpoint || d < bestEndpoint.dist)) {
        bestEndpoint = { dist: d, p: { x: ep[0], z: ep[1], y: rawCursor.y } }
      }
    }
  }
  if (bestEndpoint) {
    return {
      type: 'endpoint',
      point: bestEndpoint.p,
      label: 'Endpoint',
      color: COLOR_ENDPOINT,
    }
  }

  // 4. Wall midpoints
  let bestMidpoint: { dist: number; p: MeasurePoint; wall: WallNode } | null = null
  for (const wall of walls) {
    const mx = (wall.start[0] + wall.end[0]) / 2
    const mz = (wall.start[1] + wall.end[1]) / 2
    const d = pointDistance2D(point, [mx, mz])
    if (d < SNAP_RADIUS_POINT && (!bestMidpoint || d < bestMidpoint.dist)) {
      bestMidpoint = { dist: d, p: { x: mx, z: mz, y: rawCursor.y }, wall }
    }
  }
  if (bestMidpoint) {
    return {
      type: 'midpoint',
      point: bestMidpoint.p,
      label: 'Midpoint',
      color: COLOR_MIDPOINT,
    }
  }

  // 5. On-edge — wall projection
  let bestOnEdge: { dist: number; p: MeasurePoint; wall: WallNode } | null = null
  for (const wall of walls) {
    const { distance, projection } = pointToSegmentDistance2D(point, wall.start, wall.end)
    if (distance < SNAP_RADIUS_LINE && (!bestOnEdge || distance < bestOnEdge.dist)) {
      bestOnEdge = {
        dist: distance,
        p: { x: projection[0], z: projection[1], y: rawCursor.y },
        wall,
      }
    }
  }
  if (bestOnEdge) {
    const dx = bestOnEdge.wall.end[0] - bestOnEdge.wall.start[0]
    const dz = bestOnEdge.wall.end[1] - bestOnEdge.wall.start[1]
    const len = Math.hypot(dx, dz)
    return {
      type: 'on-edge',
      point: bestOnEdge.p,
      label: 'On Edge',
      color: COLOR_ON_EDGE,
      reference: len > 1e-6
        ? {
            origin: [bestOnEdge.wall.start[0], bestOnEdge.wall.start[1]],
            direction: [dx / len, dz / len],
          }
        : undefined,
    }
  }

  // 6. On guide line
  for (const gl of guideLines) {
    const perpDirX = -gl.refDirection[1]
    const perpDirZ = gl.refDirection[0]
    const guideOrigin: [number, number] = [
      gl.refOrigin[0] + perpDirX * gl.perpOffset,
      gl.refOrigin[1] + perpDirZ * gl.perpOffset,
    ]
    const signed = signedPerpDistance(point, { origin: guideOrigin, direction: gl.refDirection })
    if (Math.abs(signed) < SNAP_RADIUS_LINE) {
      const projX = point[0] - perpDirX * signed
      const projZ = point[1] - perpDirZ * signed
      return {
        type: 'on-guide-line',
        point: { x: projX, z: projZ, y: rawCursor.y },
        label: 'Guide Line · Del = usuń',
        color: COLOR_ON_EDGE,
        reference: { origin: guideOrigin, direction: gl.refDirection },
        deletable: { kind: 'guide-line', id: gl.id },
      }
    }
  }

  // 7. On axis X / Z / Y — od osi działki (siteCorner), NIE globalnego (0,0).
  const [cornerX, cornerZ] = siteCorner
  const distToXAxis = Math.abs(rawCursor.z - cornerZ)
  const distToZAxis = Math.abs(rawCursor.x - cornerX)
  // Y axis priority: gdy user celuje w SAM RÓG działki (cursor blisko obu osi
  // X i Z jednocześnie) — to znaczy że chce oś Y, nie X ani Z. Threshold 20cm
  // dla każdej osi — czyli kursor w prostokącie 40×40cm wokół rogu.
  if (distToXAxis < 0.2 && distToZAxis < 0.2) {
    return {
      type: 'on-axis-y',
      point: { x: cornerX, y: rawCursor.y, z: cornerZ },
      label: 'Oś Y · klik = guide point',
      color: COLOR_Y,
      reference: { origin: [cornerX, cornerZ], direction: [0, 0] }, // degenerate dla Y
    }
  }
  // Poza rogiem — X i Z (line snaps) wzdłuż osi.
  if (distToXAxis < SNAP_RADIUS_LINE && distToXAxis <= distToZAxis) {
    return {
      type: 'on-axis-x',
      point: { x: rawCursor.x, y: rawCursor.y, z: cornerZ },
      label: 'Oś X · Ctrl+klik = guide',
      color: COLOR_X,
      reference: { origin: [cornerX, cornerZ], direction: [1, 0] },
    }
  }
  if (distToZAxis < SNAP_RADIUS_LINE) {
    return {
      type: 'on-axis-z',
      point: { x: cornerX, y: rawCursor.y, z: rawCursor.z },
      label: 'Oś Z · Ctrl+klik = guide',
      color: COLOR_Z,
      reference: { origin: [cornerX, cornerZ], direction: [0, 1] },
    }
  }

  // 8. Empty space — raw cursor
  return {
    type: 'empty',
    point: rawCursor,
    label: '',
    color: COLOR_MEASURE_FREE,
  }
}

/**
 * Axis inference podczas drag (drugi click) — cursor blisko osi X/Y/Z od origin.
 */
function detectAxisInference(origin: MeasurePoint, cursor: MeasurePoint): AxisInference | null {
  const dx = cursor.x - origin.x
  const dy = cursor.y - origin.y
  const dz = cursor.z - origin.z
  const perpX = Math.hypot(dz, dy)
  const perpZ = Math.hypot(dx, dy)
  const perpY = Math.hypot(dx, dz)
  if (perpX < AXIS_INFERENCE_THRESHOLD && perpX <= perpZ && perpX <= perpY) {
    return { axis: 'x', snappedPoint: { x: cursor.x, y: origin.y, z: origin.z }, color: COLOR_X }
  }
  if (perpZ < AXIS_INFERENCE_THRESHOLD && perpZ <= perpY) {
    return { axis: 'z', snappedPoint: { x: origin.x, y: origin.y, z: cursor.z }, color: COLOR_Z }
  }
  if (perpY < AXIS_INFERENCE_THRESHOLD) {
    return { axis: 'y', snappedPoint: { x: origin.x, y: cursor.y, z: origin.z }, color: COLOR_Y }
  }
  return null
}

function classifyOriginType(snap: SnapResult): OriginType {
  if (snap.type === 'endpoint' || snap.type === 'origin' || snap.type === 'guide-point') return 'point'
  if (snap.type === 'midpoint' || snap.type === 'on-edge' || snap.type === 'on-guide-line' || snap.type === 'on-axis-x' || snap.type === 'on-axis-y' || snap.type === 'on-axis-z') return 'edge'
  return 'empty'
}

// ──────────────────────────────────────────────────────────────────────
// MAIN COMPONENT

export const MeasureTool: React.FC = () => {
  // Refs (persistent across renders, sync with handlers)
  const startRef = useRef<MeasurePoint | null>(null)
  const originSnapRef = useRef<SnapResult | null>(null) // snap captured at click 1
  const pendingLengthRef = useRef('')
  const hoverSnapRef = useRef<SnapResult | null>(null)
  // Ctrl/Meta trzymane w czasie kliku 1 → ten draft tworzy GUIDE zamiast pomiaru.
  // (Photoshop/Illustrator: bez modifier = pomiar, Ctrl+klik na oś = pull guide.)
  const ctrlHeldRef = useRef(false)
  const guideIntentRef = useRef(false) // captured at click 1

  // State (re-render)
  const [phase, setPhase] = useState<Phase>('idle')
  const [hoverSnap, setHoverSnap] = useState<SnapResult | null>(null)
  const [cursorPoint, setCursorPoint] = useState<MeasurePoint | null>(null)
  const [activeInference, setActiveInference] = useState<AxisInference | null>(null)
  const [pendingLength, setPendingLength] = useState('')
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [guideIntent, setGuideIntent] = useState(false)

  // Module store subscription
  const [storeVersion, setStoreVersion] = useState(0)
  useEffect(() => {
    const cb = () => setStoreVersion((v) => v + 1)
    measureSubscribers.add(cb)
    return () => {
      measureSubscribers.delete(cb)
    }
  }, [])
  const guideLines = moduleGuideLines
  const guidePoints = moduleGuidePoints
  const measurements = moduleMeasurements
  void storeVersion

  useEffect(() => {
    const reset = () => {
      startRef.current = null
      originSnapRef.current = null
      pendingLengthRef.current = ''
      guideIntentRef.current = false
      setPhase('idle')
      setCursorPoint(null)
      setHoverSnap(null)
      setActiveInference(null)
      setPendingLength('')
      setGuideIntent(false)
    }

    const onGridMove = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      // Stage 1: snapWallDraftPoint (Pascal native corner + edge snap)
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
      })
      const rawCursor: MeasurePoint = {
        x: snapped[0],
        z: snapped[1],
        y: event.localPosition[1],
      }

      // Stage 2: detectSnap — uniwersalna logika
      const siteCorner = getSiteCorner()
      const snap = detectSnap(rawCursor, walls, moduleGuidePoints, moduleGuideLines, moduleMeasurements, siteCorner)
      hoverSnapRef.current = snap
      setHoverSnap(snap)
      let finalCursor = snap.point

      // Stage 3: axis inference (gdy DRAGGING)
      let inference: AxisInference | null = null
      if (startRef.current) {
        inference = detectAxisInference(startRef.current, finalCursor)
        if (inference) finalCursor = inference.snappedPoint
      }
      setActiveInference(inference)
      setCursorPoint(finalCursor)
    }

    // Commit drugi klik (lub Enter z typed length) — wspólna logika
    const commitSecondClick = (cursor: MeasurePoint) => {
      let finalCursor = cursor
      const inference = detectAxisInference(startRef.current!, finalCursor)
      if (inference) finalCursor = inference.snappedPoint
      const typedMeters = parsePendingLengthToMeters(pendingLengthRef.current)
      const origin = startRef.current!
      const originType = classifyOriginType(originSnapRef.current!)
      commitInternal(origin, finalCursor, typedMeters, originType)
      reset()
    }

    const commitInternal = (
      origin: MeasurePoint,
      finalCursor: MeasurePoint,
      typedMeters: number | null,
      originType: OriginType,
    ) => {
      // Bez Ctrl (guide intent fałsz) ZAWSZE tworzymy measurement segment,
      // niezależnie od originType (point / edge / empty). Photoshop UX:
      // T = tape measure default, Ctrl + klik = pull guide z osi/krawędzi.
      if (!guideIntentRef.current) {
        const dx = finalCursor.x - origin.x
        const dy = finalCursor.y - origin.y
        const dz = finalCursor.z - origin.z
        const currentDist = Math.hypot(dx, dy, dz)
        const distance = typedMeters ?? currentDist
        if (distance < 0.001) return
        const endPoint =
          typedMeters !== null && currentDist > 0.001
            ? scalePoint(origin, finalCursor, typedMeters / currentDist)
            : finalCursor
        moduleMeasurements.push({
          id: `meas_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          start: origin,
          end: endPoint,
          label: formatLength(distance),
        })
        notifyMeasureChange()
        return
      }

      if (originType === 'point' || originType === 'empty') {
        let endPoint = finalCursor
        const dx = finalCursor.x - origin.x
        const dy = finalCursor.y - origin.y
        const dz = finalCursor.z - origin.z
        const currentDist = Math.hypot(dx, dy, dz)
        if (typedMeters !== null && currentDist > 0.001) {
          endPoint = scalePoint(origin, finalCursor, typedMeters / currentDist)
        }
        const finalDist = Math.hypot(
          endPoint.x - origin.x,
          endPoint.y - origin.y,
          endPoint.z - origin.z,
        )
        if (finalDist < 0.001) return
        moduleGuidePoints.push({
          id: `gp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          position: endPoint,
          label: formatLength(finalDist),
        })
        notifyMeasureChange()
        return
      }

      const originSnap = originSnapRef.current!
      const ref = originSnap.reference
      if (!ref) return
      const isAxisOrigin =
        originSnap.type === 'on-axis-x' ||
        originSnap.type === 'on-axis-y' ||
        originSnap.type === 'on-axis-z'
      // Y axis ma degenerate direction (0,0) — fall back na guide point w cornerze
      // (vertical guide line wymaga osobnego typu danych, na razie pomijam).
      const dirLen = Math.hypot(ref.direction[0], ref.direction[1])
      if (dirLen < 1e-6) {
        moduleGuidePoints.push({
          id: `gp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          position: { x: ref.origin[0], y: origin.y, z: ref.origin[1] },
          label: 'Oś Y',
        })
        notifyMeasureChange()
        return
      }
      const signed = signedPerpDistance([finalCursor.x, finalCursor.z], ref)
      const sign = signed >= 0 ? 1 : -1
      const perpOffset = typedMeters !== null ? sign * typedMeters : signed
      if (Math.abs(perpOffset) < 0.001) return
      const refColor = isAxisOrigin ? COLOR_AXIS_GUIDE : COLOR_WALL_GUIDE
      moduleGuideLines.push({
        id: `gl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        refOrigin: ref.origin,
        refDirection: ref.direction,
        perpOffset,
        y: origin.y,
        color: refColor,
        label: formatLength(Math.abs(perpOffset)),
      })
      notifyMeasureChange()
    }

    const onGridClick = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
      })
      const rawCursor: MeasurePoint = {
        x: snapped[0],
        z: snapped[1],
        y: event.localPosition[1],
      }
      const siteCorner = getSiteCorner()
      const snap = detectSnap(rawCursor, walls, moduleGuidePoints, moduleGuideLines, moduleMeasurements, siteCorner)

      if (phase === 'idle') {
        // Capture guide intent w momencie pierwszego kliku (Ctrl trzymany?).
        // Trwa do końca draft'u — drugi klik tworzy guide tylko gdy intent set.
        guideIntentRef.current = ctrlHeldRef.current
        setGuideIntent(ctrlHeldRef.current)
        startRef.current = snap.point
        originSnapRef.current = snap
        setPhase('dragging')
        setCursorPoint(snap.point)
        return
      }
      commitSecondClick(snap.point)
    }

    const onCancel = () => {
      if (phase === 'dragging') {
        markToolCancelConsumed() // tool stays active
        reset()
      }
      // phase === 'idle' → DON'T markToolCancelConsumed, let useKeyboard
      // switch do select tool (SketchUp behavior: Esc IDLE = exit tool).
      // Guides persist w module store nawet po unmount.
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Meta = modifier dla guide pull. Track held state — guide intent
      // łapany w momencie kliku 1 (onGridClick). Brak toggle mode'u.
      if (e.key === 'Control' || e.key === 'Meta') {
        ctrlHeldRef.current = true
        setCtrlHeld(true)
        return
      }
      // Y = clear all (Pascal extension, brak w SketchUp ale handy)
      if ((e.key === 'y' || e.key === 'Y') && !e.metaKey && !e.ctrlKey) {
        moduleGuideLines.length = 0
        moduleGuidePoints.length = 0
        moduleMeasurements.length = 0
        notifyMeasureChange()
        e.preventDefault()
        return
      }
      // Delete / Backspace w IDLE z hover na deletable → usuń ten element
      if (phase === 'idle' && (e.key === 'Delete' || e.key === 'Backspace')) {
        const target = hoverSnapRef.current?.deletable
        if (target) {
          if (target.kind === 'guide-line') {
            const idx = moduleGuideLines.findIndex((g) => g.id === target.id)
            if (idx >= 0) moduleGuideLines.splice(idx, 1)
          } else if (target.kind === 'guide-point') {
            const idx = moduleGuidePoints.findIndex((g) => g.id === target.id)
            if (idx >= 0) moduleGuidePoints.splice(idx, 1)
          } else if (target.kind === 'measurement') {
            const idx = moduleMeasurements.findIndex((m) => m.id === target.id)
            if (idx >= 0) moduleMeasurements.splice(idx, 1)
          }
          hoverSnapRef.current = null
          setHoverSnap(null)
          notifyMeasureChange()
          e.preventDefault()
          e.stopImmediatePropagation()
          return
        }
      }
      // Numeric input — działa tylko gdy aktywny draft
      if (phase !== 'dragging') return
      if (e.key >= '0' && e.key <= '9') {
        pendingLengthRef.current = pendingLengthRef.current + e.key
        setPendingLength(pendingLengthRef.current)
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if ((e.key === '.' || e.key === ',') && !pendingLengthRef.current.includes('.')) {
        pendingLengthRef.current = pendingLengthRef.current + '.'
        setPendingLength(pendingLengthRef.current)
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key === 'Backspace' && pendingLengthRef.current.length > 0) {
        pendingLengthRef.current = pendingLengthRef.current.slice(0, -1)
        setPendingLength(pendingLengthRef.current)
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key === 'Enter') {
        const meters = parsePendingLengthToMeters(pendingLengthRef.current)
        if (meters === null || !cursorPoint) return
        commitSecondClick(cursorPoint)
        e.preventDefault()
        e.stopImmediatePropagation()
      }
    }

    emitter.on('grid:move', onGridMove)
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        ctrlHeldRef.current = false
        setCtrlHeld(false)
      }
    }
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
    }
  }, [phase, cursorPoint])

  // Live measurement value for HUD
  const liveDistance = (() => {
    if (phase !== 'dragging' || !startRef.current || !cursorPoint) return null
    const typedMeters = parsePendingLengthToMeters(pendingLength)
    if (typedMeters !== null) return typedMeters
    const originType = originSnapRef.current ? classifyOriginType(originSnapRef.current) : 'empty'
    if (guideIntent && originType === 'edge' && originSnapRef.current?.reference) {
      // Perpendicular distance for guide line
      return Math.abs(signedPerpDistance([cursorPoint.x, cursorPoint.z], originSnapRef.current.reference))
    }
    // Direct distance
    return Math.hypot(
      cursorPoint.x - startRef.current.x,
      cursorPoint.y - startRef.current.y,
      cursorPoint.z - startRef.current.z,
    )
  })()

  const originSnap = originSnapRef.current
  const isAxisPull =
    originSnap?.type === 'on-axis-x' ||
    originSnap?.type === 'on-axis-y' ||
    originSnap?.type === 'on-axis-z'
  // „Parallel pull" = TYLKO gdy user trzymał Ctrl przy klik 1 (guide intent)
  // i origin to edge (oś / ściana / guide line) z niepustym direction. Wtedy
  // preview = infinite line równoległa do reference przy aktualnym perp offset
  // (Photoshop style). W innych przypadkach drag segment = matches measurement.
  const parallelPullRef =
    guideIntent && phase === 'dragging' && originSnap?.reference
      ? (() => {
          const dirLen = Math.hypot(
            originSnap.reference.direction[0],
            originSnap.reference.direction[1],
          )
          if (dirLen < 1e-6) return null
          const originType = classifyOriginType(originSnap)
          if (originType !== 'edge') return null
          return originSnap.reference
        })()
      : null
  const parallelPullColor = isAxisPull ? COLOR_AXIS_GUIDE : COLOR_WALL_GUIDE
  const dragLineColor = isAxisPull
    ? COLOR_AXIS_GUIDE
    : (activeInference?.color ?? COLOR_MEASURE_FREE)
  void guideLines
  void guidePoints
  void measurements

  return (
    <>
      {/* Persystentne guides + measurements renderowane w MeasureOverlay
          (mountowanym stale w editor/index.tsx — przetrwa tool switch). */}

      {/* Live preview — gdy parallel pull (axis/wall/guide-line origin)
          renderuj infinite parallel line w aktualnym perp offset (Photoshop
          style — guide nie ma końca). W innych przypadkach segment od origin
          do kursora. */}
      {phase === 'dragging' && startRef.current && cursorPoint && parallelPullRef && (
        <ParallelGuidePreview color={parallelPullColor} cursor={cursorPoint} reference={parallelPullRef} />
      )}
      {phase === 'dragging' && startRef.current && cursorPoint && !parallelPullRef && (
        <DragLinePreview color={dragLineColor} end={cursorPoint} start={startRef.current} />
      )}

      {/* Snap marker — pod cursor */}
      {hoverSnap && hoverSnap.type !== 'empty' && (
        <SnapMarker snap={hoverSnap} />
      )}

      {/* HUD: status badge + measurement box + tooltip */}
      <Html fullscreen style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[100, 0]}>
        {/* Mode badge — pokazuje co dostanie user po commit */}
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            left: 16,
            background: guideIntent || (ctrlHeld && phase === 'idle') ? '#dc2626cc' : '#0ea5e9cc',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {guideIntent || (ctrlHeld && phase === 'idle') ? 'GUIDE (Ctrl)' : 'POMIAR'}
          {' · Ctrl+klik = guide · Y = wyczyść'}
          {hoverSnap && hoverSnap.type !== 'empty' ? ` · ${hoverSnap.label}` : ''}
          {activeInference ? ` · oś ${activeInference.axis.toUpperCase()}` : ''}
        </div>

        {/* Measurement Box — bottom right */}
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            right: 16,
            background: '#ffffff',
            border: '2px solid #1f2937',
            padding: '8px 14px',
            borderRadius: 4,
            fontSize: 16,
            fontFamily: 'monospace',
            fontWeight: 600,
            minWidth: 160,
            color: '#1f2937',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>
            {guideIntent ? 'Guide' : 'Pomiar'}
          </span>
          <span style={{ minWidth: 80, textAlign: 'right', color: pendingLength ? '#dc2626' : undefined }}>
            {pendingLength.length > 0
              ? `${pendingLength} ${useViewer.getState().lengthUnit}`
              : liveDistance !== null
                ? formatLength(liveDistance)
                : '—'}
          </span>
        </div>
      </Html>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// PERSYSTENTNY OVERLAY — mountowany stale w editor/index.tsx,
// renderuje guides + measurements niezależnie od aktywnego narzędzia.

export const MeasureOverlay: React.FC = () => {
  const [storeVersion, setStoreVersion] = useState(0)
  useEffect(() => {
    const cb = () => setStoreVersion((v) => v + 1)
    measureSubscribers.add(cb)
    return () => {
      measureSubscribers.delete(cb)
    }
  }, [])
  void storeVersion

  return (
    <>
      {moduleGuideLines.map((g) => (
        <GuideLineRender guide={g} key={g.id} />
      ))}
      {moduleGuidePoints.map((gp) => (
        <GuidePointRender guide={gp} key={gp.id} />
      ))}
      {moduleMeasurements.map((m) =>
        m.start && m.end ? (
          <MeasureSegment color={COLOR_MEASURE_FREE} end={m.end} key={m.id} start={m.start} />
        ) : null,
      )}
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS USED IN RENDER

function scalePoint(origin: MeasurePoint, target: MeasurePoint, scale: number): MeasurePoint {
  return {
    x: origin.x + (target.x - origin.x) * scale,
    y: origin.y + (target.y - origin.y) * scale,
    z: origin.z + (target.z - origin.z) * scale,
  }
}

// ──────────────────────────────────────────────────────────────────────
// RENDER COMPONENTS

function DragLinePreview({
  color,
  end,
  start,
}: {
  color: string
  end: MeasurePoint
  start: MeasurePoint
}) {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.001) return null
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2 + HUD_OFFSET
  const midZ = (start.z + end.z) / 2
  const angleY = Math.atan2(dz, dx)
  return (
    <>
      <mesh castShadow={false} position={[midX, midY, midZ]} receiveShadow={false} rotation={[0, -angleY, 0]}>
        <boxGeometry args={[distance, LINE_THICKNESS, LINE_THICKNESS]} />
        <meshBasicMaterial color={color} depthTest={false} opacity={0.9} transparent />
      </mesh>
    </>
  )
}

/**
 * Parallel guide preview podczas drag — infinite linia równoległa do reference
 * przy aktualnym perpendicular offset od kursora. Bezpośredni odpowiednik
 * commited GuideLineRender, tylko computowany live z cursor position.
 */
function ParallelGuidePreview({
  color,
  cursor,
  reference,
}: {
  color: string
  cursor: MeasurePoint
  reference: { origin: [number, number]; direction: [number, number] }
}) {
  const signed = signedPerpDistance([cursor.x, cursor.z], reference)
  const perpDirX = -reference.direction[1]
  const perpDirZ = reference.direction[0]
  const baseX = reference.origin[0] + perpDirX * signed
  const baseZ = reference.origin[1] + perpDirZ * signed
  return (
    <DashedInfiniteLine
      basePoint={[baseX, cursor.y, baseZ]}
      color={color}
      direction={reference.direction}
      label={formatLength(Math.abs(signed))}
    />
  )
}

function MeasureSegment({
  color = COLOR_MEASURE_FREE,
  end,
  start,
}: {
  color?: string
  end: MeasurePoint | null
  start: MeasurePoint | null
}) {
  if (!start || !end) return null
  const dx = end.x - start.x
  const dz = end.z - start.z
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 0.001) return null
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2 + HUD_OFFSET
  const midZ = (start.z + end.z) / 2
  const angleY = Math.atan2(dz, dx)
  return (
    <>
      <mesh castShadow={false} position={[midX, midY, midZ]} receiveShadow={false} rotation={[0, -angleY, 0]}>
        <boxGeometry args={[distance, LINE_THICKNESS, LINE_THICKNESS]} />
        <meshBasicMaterial color={color} depthTest={false} opacity={0.9} transparent />
      </mesh>
      <Label color={color} position={[midX, midY, midZ]} text={formatLength(distance)} />
    </>
  )
}

function GuideLineRender({ guide }: { guide: GuideLine }) {
  const perpDirX = -guide.refDirection[1]
  const perpDirZ = guide.refDirection[0]
  const baseX = guide.refOrigin[0] + perpDirX * guide.perpOffset
  const baseZ = guide.refOrigin[1] + perpDirZ * guide.perpOffset
  return (
    <DashedInfiniteLine
      basePoint={[baseX, guide.y, baseZ]}
      color={guide.color}
      direction={guide.refDirection}
      label={guide.label}
    />
  )
}

function GuidePointRender({ guide }: { guide: GuidePoint }) {
  return (
    <>
      <Html
        center
        position={[guide.position.x, guide.position.y + HUD_OFFSET / 2, guide.position.z]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          style={{
            background: '#000',
            border: `2px solid ${SHADOW}`,
            borderRadius: '50%',
            height: 10,
            width: 10,
          }}
        />
      </Html>
      <Label
        color="#374151"
        position={[guide.position.x, guide.position.y + HUD_OFFSET, guide.position.z]}
        text={guide.label}
      />
    </>
  )
}

function DashedInfiniteLine({
  basePoint,
  color,
  direction,
  label,
}: {
  basePoint: [number, number, number]
  color: string
  direction: [number, number]
  label: string
}) {
  const angleY = Math.atan2(direction[1], direction[0])
  const dashSegLen = (GUIDE_LINE_LENGTH / DASH_SEGMENTS) * DASH_RATIO
  const dashStep = GUIDE_LINE_LENGTH / DASH_SEGMENTS
  const startOffset = -GUIDE_LINE_LENGTH / 2
  return (
    <>
      {Array.from({ length: DASH_SEGMENTS }, (_, i) => {
        const t = startOffset + i * dashStep + dashSegLen / 2
        const x = basePoint[0] + direction[0] * t
        const z = basePoint[2] + direction[1] * t
        return (
          <mesh
            castShadow={false}
            key={i}
            position={[x, basePoint[1], z]}
            receiveShadow={false}
            rotation={[0, -angleY, 0]}
          >
            <boxGeometry args={[dashSegLen, LINE_THICKNESS, LINE_THICKNESS]} />
            <meshBasicMaterial color={color} depthTest={false} opacity={0.8} transparent />
          </mesh>
        )
      })}
      {label ? <Label color={color} position={basePoint} text={label} /> : null}
    </>
  )
}

/**
 * Snap marker — colored shape pod cursor wskazujący typ snap'a.
 * Endpoint/origin/guide-point → kółko, midpoint → kółko cyan,
 * on-edge → kwadrat, on-axis → kreska wzdłuż osi w pozycji cursor.
 */
function SnapMarker({ snap }: { snap: SnapResult }) {
  const isSquare = snap.type === 'on-edge' || snap.type === 'on-guide-line'
  const isAxis = snap.type === 'on-axis-x' || snap.type === 'on-axis-y' || snap.type === 'on-axis-z'
  // Snap na ścianach (centerline) jest na podłodze — podnieś marker na środek
  // wysokości ściany żeby był widoczny ponad mesh'em. Inne snapy (origin,
  // guide-point) zachowują własną wysokość.
  const isWallSnap = snap.type === 'endpoint' || snap.type === 'midpoint' || snap.type === 'on-edge' || snap.type === 'measurement-endpoint'
  const markerY = isWallSnap ? snap.point.y + SNAP_MARKER_ELEVATION : snap.point.y + HUD_OFFSET
  const stemHeight = markerY - snap.point.y
  return (
    <>
      {/* Pionowy stem 3D od podłogi do markera — SketchUp inference extension.
          Pokazuje user'owi że snap jest geometrycznie na ścianie w tym XZ. */}
      {isWallSnap && stemHeight > 0.05 && (
        <mesh
          castShadow={false}
          position={[snap.point.x, snap.point.y + stemHeight / 2, snap.point.z]}
          receiveShadow={false}
        >
          <boxGeometry args={[SNAP_STEM_THICKNESS, stemHeight, SNAP_STEM_THICKNESS]} />
          <meshBasicMaterial color={snap.color} depthTest={false} opacity={0.7} transparent />
        </mesh>
      )}
      <Html
        center
        position={[snap.point.x, markerY, snap.point.z]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[200, 0]}
      >
        <div style={{ position: 'relative' }}>
          <div
            style={{
              background: snap.color,
              border: `2px solid ${SHADOW}`,
              borderRadius: isSquare || isAxis ? 2 : '50%',
              height: POINT_MARKER_SIZE,
              width: POINT_MARKER_SIZE,
              transform: 'translate(-50%, -50%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 14,
              top: -8,
              background: '#1f2937',
              color: '#fff',
              padding: '2px 6px',
              borderRadius: 3,
              fontSize: 10,
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
          >
            {snap.label}
          </div>
        </div>
      </Html>
    </>
  )
}

function Label({
  color,
  position,
  text,
}: {
  color: string
  position: [number, number, number]
  text: string
}) {
  return (
    <Html
      center
      position={position}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[100, 0]}
    >
      <div
        className="whitespace-nowrap font-bold font-mono text-[13px]"
        style={{
          color,
          textShadow: `-1.5px -1.5px 0 ${SHADOW}, 1.5px -1.5px 0 ${SHADOW}, -1.5px 1.5px 0 ${SHADOW}, 1.5px 1.5px 0 ${SHADOW}, 0 0 4px ${SHADOW}, 0 0 4px ${SHADOW}`,
        }}
      >
        {text}
      </div>
    </Html>
  )
}
