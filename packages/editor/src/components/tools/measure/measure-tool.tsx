'use client'

/**
 * GSI fork — SketchUp-accurate Tape Measure tool ("T" key).
 *
 * **Dwa tryby (Ctrl toggle):**
 *
 * 1. **MEASURE (default)** — pomiar point-to-point z persystencją.
 *    - Klik 1 → start (snap corner/edge/grid)
 *    - Drag → free cursor + label live
 *    - Klik 2 → komituje persistent segment (linia + label zostaje)
 *
 * 2. **GUIDE** — perpendicular infinite line z reference (axis lub wall).
 *    - Klik 1 na **osi X/Z LUB na ścianie** → captures reference line
 *    - Drag prostopadle → live preview dashed line równoległą do reference
 *    - Klik 2 LUB typed dim + Enter → infinite dashed guide zostaje
 *
 * **Klawisze:**
 *   - **Ctrl** = toggle MEASURE ↔ GUIDE (e.repeat filtered)
 *   - **Esc** = cancel aktywnego draft (NIE czyści persisted)
 *   - **Y** = clear all (guides + measurements)
 *   - **0-9, ., Enter, Backspace** = numeric input dla exact distance
 *
 * **Architektura GUIDE reference**:
 * Generic `Reference = { origin: [x,z], direction: [dx,dz] }` w XZ plane
 * (Y = wysokość, plan view). Axis X = (0,0)+(1,0), Z = (0,0)+(0,1),
 * Wall = (start)+normalize(end-start). Perpendicular distance =
 * |(cursor - origin) - ((cursor - origin) · direction) * direction|.
 * Guide line = origin + perpDir * perpOffset, extending ±direction.
 *
 * **Render**: 3D mesh boxes z `castShadow={false}` (proven OK z
 * SceneAxes — Pascal WebGPU). HTML overlay tylko dla labels i dots.
 */

import { emitter, type GridEvent, type WallNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
// Plik wewnątrz pakietu editor — relative imports.
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { snapWallDraftPoint } from '../wall/wall-drafting'

const MEASURE_COLOR = '#0ea5e9' // sky-500
const GUIDE_COLOR_AXIS_X = '#ef4444' // red-500
const GUIDE_COLOR_AXIS_Z = '#3b82f6' // blue-500
const GUIDE_COLOR_WALL = '#a855f7' // purple-500
const SHADOW = '#ffffff'
const HUD_OFFSET = 0.02
const LINE_THICKNESS = 0.01 // 10 mm
const GUIDE_LINE_LENGTH = 60 // m
const DASH_SEGMENTS = 30
const DASH_RATIO = 0.55
const SNAP_RADIUS = 0.5 // 50 cm snap radius dla osi i ścian

type Mode = 'measure' | 'guide'

interface MeasurePoint {
  x: number
  z: number
  y: number
}

/** Reference line — axis lub wall edge. */
interface Reference {
  origin: [number, number] // punkt na linii w XZ
  direction: [number, number] // normalized direction w XZ
  label: string // 'oś X' / 'oś Z' / 'ściana N'
  color: string
}

interface GuideLine {
  id: string
  ref: Reference
  perpOffset: number // signed perpendicular distance od reference
  y: number
  label: string
}

interface MeasurementSegment {
  id: string
  start: MeasurePoint
  end: MeasurePoint
  label: string
}

// ──────────────────────────────────────────────────────────────────────
// Module-scope store (przetrwa MeasureTool unmount przy tool switch).
// Pełna persystencja przez floor_plans DB = osobny task (postMessage
// bridge GSI parent ↔ Pascal embed + API extension). Module-scope to
// minimum viable — guides ostają po Esc/Space/przełączeniu na Wall etc.,
// ale ginie po iframe reload (nawigacja na inny tab projektu).

const moduleGuides: GuideLine[] = []
const moduleMeasurements: MeasurementSegment[] = []
const measureSubscribers = new Set<() => void>()

function notifyMeasureChange() {
  for (const cb of measureSubscribers) cb()
}

function addModuleGuide(g: GuideLine): void {
  moduleGuides.push(g)
  notifyMeasureChange()
}

function addModuleMeasurement(m: MeasurementSegment): void {
  moduleMeasurements.push(m)
  notifyMeasureChange()
}

function clearAllModuleMeasures(): void {
  moduleGuides.length = 0
  moduleMeasurements.length = 0
  notifyMeasureChange()
}

// ──────────────────────────────────────────────────────────────────────
// Helpers

function getCurrentLevelWalls(): WallNode[] {
  const { selection } = useViewer.getState()
  const { nodes } = useScene.getState()
  const levelId = selection.levelId
  if (!levelId) return []
  return Object.values(nodes).filter(
    (node): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
  )
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

/** Distance point-to-line in 2D. Returns { distance, sign } gdzie sign = ±1 (która strona). */
function pointToLineDistance(
  point: [number, number],
  ref: Reference,
): { distance: number; signed: number } {
  const dx = point[0] - ref.origin[0]
  const dz = point[1] - ref.origin[1]
  // Perpendicular = rotated 90° in 2D: (-dz, dx) lub (dz, -dx).
  // Używamy (-direction.z, direction.x) jako "left perpendicular".
  const perpDirX = -ref.direction[1]
  const perpDirZ = ref.direction[0]
  // Signed distance = dot(point - origin, perpDir).
  const signed = dx * perpDirX + dz * perpDirZ
  return { distance: Math.abs(signed), signed }
}

/** Distance point-to-segment in 2D (clamped do segmentu, nie do nieskończonej linii). */
function pointToSegmentDistance(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
): number {
  const dx = segEnd[0] - segStart[0]
  const dz = segEnd[1] - segStart[1]
  const lenSq = dx * dx + dz * dz
  if (lenSq < 1e-9) return Math.hypot(point[0] - segStart[0], point[1] - segStart[1])
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - segStart[0]) * dx + (point[1] - segStart[1]) * dz) / lenSq),
  )
  const projX = segStart[0] + t * dx
  const projZ = segStart[1] + t * dz
  return Math.hypot(point[0] - projX, point[1] - projZ)
}

/**
 * Wykrywa najbliższą reference (axis X/Z lub wall edge) w pobliżu cursora.
 * Returns null jeśli nic w SNAP_RADIUS.
 */
function detectReference(cursor: MeasurePoint, walls: WallNode[]): Reference | null {
  const point: [number, number] = [cursor.x, cursor.z]
  // Najpierw walls (priorytet bo user zwykle celuje w ściany).
  let bestWallDist = SNAP_RADIUS
  let bestWall: WallNode | null = null
  for (const wall of walls) {
    const d = pointToSegmentDistance(point, wall.start, wall.end)
    if (d < bestWallDist) {
      bestWallDist = d
      bestWall = wall
    }
  }
  if (bestWall) {
    const dx = bestWall.end[0] - bestWall.start[0]
    const dz = bestWall.end[1] - bestWall.start[1]
    const len = Math.hypot(dx, dz)
    if (len > 1e-6) {
      const wallIndex = walls.indexOf(bestWall) + 1
      return {
        origin: [bestWall.start[0], bestWall.start[1]],
        direction: [dx / len, dz / len],
        label: `ściana ${wallIndex}`,
        color: GUIDE_COLOR_WALL,
      }
    }
  }
  // Potem osie X i Z (tylko gdy cursor blisko origin).
  const distToXAxis = Math.abs(cursor.z) // X axis na z=0
  const distToZAxis = Math.abs(cursor.x) // Z axis na x=0
  if (distToXAxis < SNAP_RADIUS && distToXAxis <= distToZAxis) {
    return {
      origin: [0, 0],
      direction: [1, 0],
      label: 'oś X',
      color: GUIDE_COLOR_AXIS_X,
    }
  }
  if (distToZAxis < SNAP_RADIUS) {
    return {
      origin: [0, 0],
      direction: [0, 1],
      label: 'oś Z',
      color: GUIDE_COLOR_AXIS_Z,
    }
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────
// Tool component

export const MeasureTool: React.FC = () => {
  const startRef = useRef<MeasurePoint | null>(null)
  const referenceRef = useRef<Reference | null>(null)
  const pendingLengthRef = useRef('')

  const [mode, setMode] = useState<Mode>('measure')
  const [start, setStart] = useState<MeasurePoint | null>(null)
  const [cursorPoint, setCursorPoint] = useState<MeasurePoint | null>(null)
  const [reference, setReference] = useState<Reference | null>(null)
  const [pendingLength, setPendingLength] = useState('')

  // GSI fork: guides + measurements w module-scope — przetrwają unmount
  // przy switch'u toola. Subscription pattern wymusza re-render gdy
  // module store się zmieni. Pełna DB persystencja = osobny task.
  const [storeVersion, setStoreVersion] = useState(0)
  useEffect(() => {
    const cb = () => setStoreVersion((v) => v + 1)
    measureSubscribers.add(cb)
    return () => {
      measureSubscribers.delete(cb)
    }
  }, [])
  const guides = moduleGuides
  const measurements = moduleMeasurements
  void storeVersion // force-use żeby useEffect re-evaluacja działała

  useEffect(() => {
    const reset = () => {
      startRef.current = null
      referenceRef.current = null
      pendingLengthRef.current = ''
      setStart(null)
      setCursorPoint(null)
      setReference(null)
      setPendingLength('')
    }

    const commitGuide = (ref: Reference, perpOffset: number, y: number) => {
      if (Math.abs(perpOffset) < 0.001) return
      addModuleGuide({
        id: `guide_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ref,
        perpOffset,
        y,
        label: formatLength(Math.abs(perpOffset)),
      })
    }

    const onGridMove = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
      })
      const cursor: MeasurePoint = {
        x: snapped[0],
        z: snapped[1],
        y: event.localPosition[1],
      }
      setCursorPoint(cursor)
      // GUIDE mode pre-click: highlight reference under cursor.
      if (mode === 'guide' && !startRef.current) {
        setReference(detectReference(cursor, walls))
      }
    }

    const onGridClick = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
      })
      const cursor: MeasurePoint = {
        x: snapped[0],
        z: snapped[1],
        y: event.localPosition[1],
      }

      if (mode === 'measure') {
        if (!startRef.current) {
          startRef.current = cursor
          setStart(cursor)
          setCursorPoint(cursor)
          return
        }
        // Klik 2 — commit segment.
        const distance = Math.hypot(
          cursor.x - startRef.current.x,
          cursor.y - startRef.current.y,
          cursor.z - startRef.current.z,
        )
        if (distance >= 0.001) {
          addModuleMeasurement({
            id: `meas_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            start: startRef.current!,
            end: cursor,
            label: formatLength(distance),
          })
        }
        reset()
        return
      }

      // GUIDE flow.
      if (!startRef.current) {
        const ref = detectReference(cursor, walls)
        if (!ref) return // brak reference — wymagamy klika w pobliżu osi / ściany
        startRef.current = cursor
        referenceRef.current = ref
        setStart(cursor)
        setReference(ref)
        return
      }
      // Klik 2 — commit guide.
      const ref = referenceRef.current
      if (!ref) {
        reset()
        return
      }
      const typedMeters = parsePendingLengthToMeters(pendingLengthRef.current)
      const { signed } = pointToLineDistance([cursor.x, cursor.z], ref)
      const sign = signed >= 0 ? 1 : -1
      const perpOffset = typedMeters !== null ? sign * typedMeters : signed
      commitGuide(ref, perpOffset, cursor.y)
      reset()
    }

    const onCancel = () => {
      // Esc ZAWSZE markCancelConsumed w MeasureTool — w przeciwnym razie
      // useKeyboard switch'uje do Select tool, MeasureTool unmount'uje
      // i local state (guides + measurements) znika. User chciał guides
      // przetrwać. Wyjście z toola = Space (Select) albo klik w toolbarze.
      markToolCancelConsumed()
      if (startRef.current) {
        reset() // cancel aktywny draft
      }
      // Bez draftu — Esc no-op (NIE czyści guides/measurements ani toola).
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl toggle mode (e.repeat filtered).
      if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat) {
        setMode((prev) => (prev === 'measure' ? 'guide' : 'measure'))
        if (startRef.current) reset()
        e.preventDefault()
        return
      }
      // Y = clear all (module-scope).
      if ((e.key === 'y' || e.key === 'Y') && !e.metaKey && !e.ctrlKey) {
        clearAllModuleMeasures()
        e.preventDefault()
        return
      }
      // Numeric input — działa tylko gdy aktywny draft.
      if (!startRef.current) return
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
        if (meters === null) return
        // Tylko GUIDE mode obsługuje typed length commit (MEASURE wymaga klik 2).
        if (mode === 'guide' && referenceRef.current && cursorPoint) {
          const { signed } = pointToLineDistance(
            [cursorPoint.x, cursorPoint.z],
            referenceRef.current,
          )
          const sign = signed >= 0 ? 1 : -1
          commitGuide(referenceRef.current, sign * meters, startRef.current.y)
          reset()
          e.preventDefault()
          e.stopImmediatePropagation()
        }
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [mode, cursorPoint])

  // Live preview perp distance (dla measurement box).
  const livePerpOffset = (() => {
    if (mode !== 'guide' || !reference || !cursorPoint) return null
    const typedMeters = parsePendingLengthToMeters(pendingLength)
    if (typedMeters !== null) return typedMeters
    return pointToLineDistance([cursorPoint.x, cursorPoint.z], reference).distance
  })()

  // Live preview distance (dla measurement box w MEASURE mode).
  const liveMeasureDistance = (() => {
    if (mode !== 'measure' || !start || !cursorPoint) return null
    return Math.hypot(
      cursorPoint.x - start.x,
      cursorPoint.y - start.y,
      cursorPoint.z - start.z,
    )
  })()

  return (
    <>
      {/* Committed guides */}
      {guides.map((g) => (
        <GuideRender guide={g} key={g.id} />
      ))}

      {/* Committed measurements */}
      {measurements.map((m) =>
        m.start && m.end ? <MeasureSegment end={m.end} key={m.id} start={m.start} /> : null,
      )}

      {/* Live preview — GUIDE draft */}
      {mode === 'guide' && start && cursorPoint && reference && (
        <GuidePreview
          cursor={cursorPoint}
          ref_={reference}
          start={start}
          typedMeters={parsePendingLengthToMeters(pendingLength)}
        />
      )}

      {/* Live preview — MEASURE draft */}
      {mode === 'measure' && start && cursorPoint && (
        <MeasureSegment end={cursorPoint} start={start} />
      )}

      {/* Mode HUD + Measurement Box */}
      <Html
        fullscreen
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        {/* Mode badge — bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            left: 16,
            background: mode === 'guide' ? '#dc2626cc' : '#0ea5e9cc',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {mode === 'guide' ? 'GUIDE' : 'MEASURE'} · Ctrl = przełącz · Y = wyczyść
          {reference && mode === 'guide' ? ` · ${reference.label}` : ''}
        </div>

        {/* Measurement Box — bottom right (SketchUp-style) */}
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
            textAlign: 'right',
            color: '#1f2937',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <span style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase' }}>
            {mode === 'guide' ? 'Odległość' : 'Pomiar'}
          </span>
          <span style={{ minWidth: 80, color: pendingLength ? '#dc2626' : undefined }}>
            {pendingLength.length > 0
              ? `${pendingLength} ${useViewer.getState().lengthUnit}`
              : livePerpOffset !== null
                ? formatLength(livePerpOffset)
                : liveMeasureDistance !== null
                  ? formatLength(liveMeasureDistance)
                  : '—'}
          </span>
        </div>
      </Html>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Render components

function GuideRender({ guide }: { guide: GuideLine }) {
  const { ref, perpOffset, y, label } = guide
  // Position guide line: origin + perpDir * perpOffset
  const perpDirX = -ref.direction[1]
  const perpDirZ = ref.direction[0]
  const baseX = ref.origin[0] + perpDirX * perpOffset
  const baseZ = ref.origin[1] + perpDirZ * perpOffset
  return (
    <DashedLine
      basePoint={[baseX, y, baseZ]}
      color={ref.color}
      direction={ref.direction}
      label={label}
    />
  )
}

function GuidePreview({
  cursor,
  ref_,
  start,
  typedMeters,
}: {
  cursor: MeasurePoint | null
  ref_: Reference | null
  start: MeasurePoint | null
  typedMeters: number | null
}) {
  if (!start || !cursor || !ref_) return null
  const { signed, distance } = pointToLineDistance([cursor.x, cursor.z], ref_)
  const sign = signed >= 0 ? 1 : -1
  const perpOffset = typedMeters !== null ? sign * typedMeters : signed
  const perpDirX = -ref_.direction[1]
  const perpDirZ = ref_.direction[0]
  const baseX = ref_.origin[0] + perpDirX * perpOffset
  const baseZ = ref_.origin[1] + perpDirZ * perpOffset
  const labelText = formatLength(typedMeters !== null ? typedMeters : distance)
  return (
    <>
      <Dot color={ref_.color} position={[start.x, start.y + HUD_OFFSET / 2, start.z]} />
      <DashedLine
        basePoint={[baseX, start.y, baseZ]}
        color={ref_.color}
        direction={ref_.direction}
        label={labelText}
      />
    </>
  )
}

function MeasureSegment({ end, start }: { end: MeasurePoint | null; start: MeasurePoint | null }) {
  if (!start || !end) return null
  const dx = end.x - start.x
  const dz = end.z - start.z
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 0.001) return null
  const midX = (start.x + end.x) / 2
  const midY = (start.y + end.y) / 2 + HUD_OFFSET
  const midZ = (start.z + end.z) / 2

  // 3D solid line — box rotated wzdłuż direction. Position = midpoint.
  // Aby uniknąć rotation matrix, używamy trzech sub-boxes w 3D, ale
  // dla 2D plan (dy≈0) wystarcza single box rotated wokół Y.
  // Rotation kąt y axis: atan2(-dx, dz) lub odwrotnie zależnie od konwencji.
  const angleY = Math.atan2(dz, dx)
  return (
    <>
      <mesh castShadow={false} position={[midX, midY, midZ]} receiveShadow={false} rotation={[0, -angleY, 0]}>
        <boxGeometry args={[distance, LINE_THICKNESS, LINE_THICKNESS]} />
        <meshBasicMaterial color={MEASURE_COLOR} depthTest={false} opacity={0.9} transparent />
      </mesh>
      <Dot color={MEASURE_COLOR} position={[start.x, start.y + HUD_OFFSET / 2, start.z]} />
      <Dot color={MEASURE_COLOR} position={[end.x, end.y + HUD_OFFSET / 2, end.z]} />
      <Label color={MEASURE_COLOR} position={[midX, midY, midZ]} text={formatLength(distance)} />
    </>
  )
}

/**
 * Infinite dashed line wzdłuż `direction` przechodząca przez `basePoint`.
 * Rendered jako N krótkich boxGeometry meshes. castShadow=false +
 * receiveShadow=false żeby Pascal shadow pass nie próbował MeshLambertNode
 * material crashującego pipeline.
 */
function DashedLine({
  basePoint,
  color,
  direction,
  label,
}: {
  basePoint: [number, number, number]
  color: string
  direction: [number, number] // XZ plane
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
      <Label color={color} position={basePoint} text={label} />
    </>
  )
}

function Dot({ color, position }: { color: string; position: [number, number, number] }) {
  return (
    <Html
      center
      position={position}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[100, 0]}
    >
      <div
        style={{
          background: color,
          border: `2px solid ${SHADOW}`,
          borderRadius: '50%',
          height: 12,
          width: 12,
        }}
      />
    </Html>
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
