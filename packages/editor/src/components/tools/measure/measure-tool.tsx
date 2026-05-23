'use client'

/**
 * GSI fork — SketchUp-accurate Tape Measure tool ("T" key).
 *
 * **Dwa tryby:**
 *
 * 1. **MEASURE (default)** — pomiar point-to-point.
 *    - Klik 1 → start (snap corner/edge/grid)
 *    - Drag → free cursor, label z odległością live
 *    - Klik 2 → komituje persistent measurement (linia + label zostaje)
 *
 * 2. **GUIDE** — perpendicular infinite line z reference axis.
 *    - Klik 1 na **osi X/Z** → captures reference axis
 *    - Drag → live preview dashed line w pozycji cursora
 *    - Klik 2 LUB typed dim + Enter → komituje INFINITE dashed guide line
 *
 * **Ctrl = toggle mode** (single press = flip MEASURE ↔ GUIDE; key repeat
 * filtered przez e.repeat).
 *
 * **Klawisze:**
 *   - **Esc** → cancel aktywnego draft (NIE czyści guides)
 *   - **Y** → wyczyść wszystkie guides
 *   - **0-9, ., Enter, Backspace** → numeric input dla exact distance
 *
 * Guides persist w session-local state — żyją dopóki tool jest aktywny
 * (przejście na inne narzędzie kasuje, bo MeasureTool unmount się).
 */

import { emitter, type GridEvent, type WallNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
// Plik wewnątrz pakietu editor — relative imports, nie '@pascal-app/editor'.
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { snapWallDraftPoint } from '../wall/wall-drafting'

// Kolory wg konwencji SketchUp axis: X-red, Z-blue. Y-green (rzadko w 2D).
const AXIS_COLORS: Record<Axis, string> = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
}
const MEASURE_COLOR = '#0ea5e9' // sky-500 — neutralna dla point-to-point measure
const SHADOW = '#ffffff'
const HUD_OFFSET = 0.02
const LINE_THICKNESS = 0.008 // 8 mm
const GUIDE_LINE_LENGTH = 60 // m — infinite-ish, traverse typową scenę
const DASH_SEGMENTS = 40 // ilość dash segmentów na guide line
const DASH_RATIO = 0.55 // 55% segmentu visible, 45% gap
const AXIS_SNAP_RADIUS = 0.5 // 50 cm — jeśli cursor w tym dystansie od osi, snap

type Mode = 'measure' | 'guide'
type Axis = 'x' | 'y' | 'z'

interface MeasurePoint {
  x: number
  z: number
  y: number
}

interface GuideLine {
  id: string
  // Reference axis (X / Y / Z). Guide jest równoległy do tej osi.
  axis: Axis
  // Perpendicular distance — gdzie guide leży na osi prostopadłej:
  //   axis=x → guide na pozycji `perpZ` wzdłuż Z (przecina X w 1 punkcie)
  //   axis=z → guide na pozycji `perpX` wzdłuż X
  //   axis=y → guide pionowy, perpX/perpZ obie identifikują kolumnę
  perpX: number
  perpZ: number
  y: number // wysokość bazowa (zwykle 0 dla plan view)
  label: string
}

interface MeasurementSegment {
  id: string
  start: MeasurePoint
  end: MeasurePoint
  label: string
}

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

/**
 * Wykrywa oś-reference w pobliżu cursora. Returns null jeśli cursor NIE
 * jest w pobliżu żadnej osi (>AXIS_SNAP_RADIUS od X i Z osi).
 *
 * W 2D plan view dominującymi osiami reference są X i Z (Y jest pionowa,
 * w plan view = 1 punkt na osi).
 */
function detectReferenceAxis(point: MeasurePoint): Axis | null {
  const distToXAxis = Math.abs(point.z) // odległość od X-axis (z=0)
  const distToZAxis = Math.abs(point.x) // odległość od Z-axis (x=0)
  if (distToXAxis < AXIS_SNAP_RADIUS && distToXAxis <= distToZAxis) return 'x'
  if (distToZAxis < AXIS_SNAP_RADIUS) return 'z'
  return null
}

/**
 * Compute perpendicular distance od cursora do reference axis.
 *
 *   axis=x → perp = |cursor.z| (oś X leży na z=0)
 *   axis=z → perp = |cursor.x| (oś Z leży na x=0)
 *   axis=y → perp = sqrt(cursor.x² + cursor.z²)
 */
function perpDistanceToAxis(cursor: MeasurePoint, axis: Axis): number {
  if (axis === 'x') return Math.abs(cursor.z)
  if (axis === 'z') return Math.abs(cursor.x)
  return Math.hypot(cursor.x, cursor.z)
}

/**
 * Sign: po której stronie osi cursor leży? Używamy do określenia kierunku
 * gdy user wpisze typed dimension.
 */
function signOfPerpendicular(cursor: MeasurePoint, axis: Axis): 1 | -1 {
  if (axis === 'x') return cursor.z >= 0 ? 1 : -1
  if (axis === 'z') return cursor.x >= 0 ? 1 : -1
  return cursor.x >= 0 ? 1 : -1
}

export const MeasureTool: React.FC = () => {
  // Persistent state across renders
  const startRef = useRef<MeasurePoint | null>(null)
  const referenceAxisRef = useRef<Axis | null>(null) // captured at klik 1 (guide mode)
  const pendingLengthRef = useRef('')

  // Re-rendering state
  const [mode, setMode] = useState<Mode>('measure')
  const [start, setStart] = useState<MeasurePoint | null>(null)
  const [cursorPoint, setCursorPoint] = useState<MeasurePoint | null>(null)
  const [referenceAxis, setReferenceAxis] = useState<Axis | null>(null)
  const [pendingLength, setPendingLength] = useState('')
  const [guides, setGuides] = useState<GuideLine[]>([])
  const [measurements, setMeasurements] = useState<MeasurementSegment[]>([])

  useEffect(() => {
    const reset = () => {
      startRef.current = null
      referenceAxisRef.current = null
      pendingLengthRef.current = ''
      setStart(null)
      setCursorPoint(null)
      setReferenceAxis(null)
      setPendingLength('')
    }

    const commitGuide = (axis: Axis, perpDist: number, sign: 1 | -1, y: number) => {
      // Compute pozycję perp coordinates w przestrzeni.
      const signed = sign * perpDist
      const perpX = axis === 'z' || axis === 'y' ? signed : 0
      const perpZ = axis === 'x' || axis === 'y' ? signed : 0
      setGuides((prev) => [
        ...prev,
        {
          id: `guide_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          axis,
          perpX,
          perpZ,
          y,
          label: formatLength(perpDist),
        },
      ])
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
      // GUIDE mode pre-click: highlight axis under cursor.
      if (mode === 'guide' && !startRef.current) {
        setReferenceAxis(detectReferenceAxis(cursor))
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
        // Point-to-point measure flow.
        if (!startRef.current) {
          startRef.current = cursor
          setStart(cursor)
          setCursorPoint(cursor)
          return
        }
        // Klik 2 — commit measurement segment jako persistent.
        const distance = Math.hypot(
          cursor.x - startRef.current.x,
          cursor.y - startRef.current.y,
          cursor.z - startRef.current.z,
        )
        if (distance >= 0.001) {
          setMeasurements((prev) => [
            ...prev,
            {
              id: `meas_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              start: startRef.current!,
              end: cursor,
              label: formatLength(distance),
            },
          ])
        }
        reset()
        return
      }

      // GUIDE mode flow.
      if (!startRef.current) {
        // Klik 1 — capture reference axis.
        const refAxis = detectReferenceAxis(cursor)
        if (!refAxis) {
          // Brak osi blisko — w naszym MVP guide tylko dla osi X/Z.
          // (Future: też wall edges → wall-aligned guides.)
          return
        }
        startRef.current = cursor
        referenceAxisRef.current = refAxis
        setStart(cursor)
        setReferenceAxis(refAxis)
        return
      }
      // Klik 2 — commit guide.
      const axis = referenceAxisRef.current ?? 'x'
      const typedMeters = parsePendingLengthToMeters(pendingLengthRef.current)
      const perpDist = typedMeters ?? perpDistanceToAxis(cursor, axis)
      const sign = signOfPerpendicular(cursor, axis)
      commitGuide(axis, perpDist, sign, cursor.y)
      reset()
    }

    const onCancel = () => {
      // Esc: tylko anuluje aktywny draft. NIE czyści guides ani measurements.
      // Clearing guides = Y shortcut.
      if (startRef.current) {
        markToolCancelConsumed()
        reset()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl = toggle mode (single press = flip MEASURE ↔ GUIDE).
      // e.repeat filtered żeby trzymanie Ctrl NIE rolało setMode w pętli.
      if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat) {
        setMode((prev) => (prev === 'measure' ? 'guide' : 'measure'))
        // Cancel aktywny draft żeby tryb się "czysto" przełączył.
        if (startRef.current) reset()
        e.preventDefault()
        return
      }
      // Y = clear all guides + measurements.
      if ((e.key === 'y' || e.key === 'Y') && !e.metaKey && !e.ctrlKey) {
        setGuides([])
        setMeasurements([])
        e.preventDefault()
        return
      }
      if (!startRef.current || mode !== 'guide') return
      // Numeric input dla typed perpendicular distance.
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
        if (meters === null || !startRef.current || !referenceAxisRef.current) return
        const axis = referenceAxisRef.current
        const sign = cursorPoint ? signOfPerpendicular(cursorPoint, axis) : 1
        commitGuide(axis, meters, sign, startRef.current.y)
        reset()
        e.preventDefault()
        e.stopImmediatePropagation()
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

  return (
    <>
      {/* Committed guides — infinite dashed lines */}
      {guides.map((g) => (
        <GuideRender guide={g} key={g.id} />
      ))}

      {/* Committed point-to-point measurements (persistent segments) */}
      {measurements.map((m) =>
        m.start && m.end ? <MeasurePreview end={m.end} key={m.id} start={m.start} /> : null,
      )}

      {/* Live preview: GUIDE mode draft */}
      {mode === 'guide' && start && cursorPoint && referenceAxis && (
        <GuidePreview
          axis={referenceAxis}
          cursor={cursorPoint}
          start={start}
          typedMeters={parsePendingLengthToMeters(pendingLength)}
        />
      )}

      {/* Live preview: MEASURE mode draft (point-to-point) */}
      {mode === 'measure' && start && cursorPoint && (
        <MeasurePreview end={cursorPoint} start={start} />
      )}

      {/* Mode HUD */}
      <Html fullscreen style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[100, 0]}>
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
          {referenceAxis && mode === 'guide' ? ` · oś ${referenceAxis.toUpperCase()}` : ''}
          {pendingLength.length > 0 ? ` · wpisuję: ${pendingLength}` : ''}
        </div>
      </Html>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Render components

function MeasurePreview({ end, start }: { end: MeasurePoint | null; start: MeasurePoint | null }) {
  // Defensive guard — w wyniku React Strict Mode + HMR + tool re-mount
  // czasem render trafia z stale null props. Tani if zamiast crashu
  // ErrorBoundary (rozwala cały viewer).
  if (!start || !end) return null
  const dx = end.x - start.x
  const dz = end.z - start.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.001) return null
  const midX = (start.x + end.x) / 2
  const midZ = (start.z + end.z) / 2
  const midY = (start.y + end.y) / 2 + HUD_OFFSET
  return (
    <>
      <Dot color={MEASURE_COLOR} position={[start.x, start.y + HUD_OFFSET / 2, start.z]} />
      <Dot color={MEASURE_COLOR} position={[end.x, end.y + HUD_OFFSET / 2, end.z]} />
      <Label color={MEASURE_COLOR} position={[midX, midY, midZ]} text={formatLength(distance)} />
    </>
  )
}

function GuidePreview({
  axis,
  cursor,
  start,
  typedMeters,
}: {
  axis: Axis
  cursor: MeasurePoint | null
  start: MeasurePoint | null
  typedMeters: number | null
}) {
  if (!start || !cursor) return null
  const color = AXIS_COLORS[axis]
  const perpDist = typedMeters ?? perpDistanceToAxis(cursor, axis)
  const sign = signOfPerpendicular(cursor, axis)
  const signed = sign * perpDist

  // Visual: dashed preview line w pozycji cursor (gdzie guide poszedłby).
  // Axis=X → preview line równolegle do X w pozycji z=signed
  // Axis=Z → preview line równolegle do Z w pozycji x=signed
  const guideLineAt: { axis: Axis; perpX: number; perpZ: number; y: number } = {
    axis,
    perpX: axis === 'z' ? signed : 0,
    perpZ: axis === 'x' ? signed : 0,
    y: start.y,
  }

  const labelPos: [number, number, number] = [
    axis === 'x' ? 0 : signed,
    start.y + HUD_OFFSET,
    axis === 'z' ? 0 : signed,
  ]

  return (
    <>
      <Dot color={color} position={[start.x, start.y + HUD_OFFSET / 2, start.z]} />
      <DashedInfiniteLine
        axis={guideLineAt.axis}
        color={color}
        opacity={0.7}
        perpX={guideLineAt.perpX}
        perpZ={guideLineAt.perpZ}
        y={guideLineAt.y}
      />
      <Label color={color} position={labelPos} text={formatLength(perpDist)} />
    </>
  )
}

function GuideRender({ guide }: { guide: GuideLine }) {
  const color = AXIS_COLORS[guide.axis]
  const labelPos: [number, number, number] = [
    guide.axis === 'x' ? 0 : guide.perpX,
    guide.y + HUD_OFFSET,
    guide.axis === 'z' ? 0 : guide.perpZ,
  ]
  return (
    <>
      <DashedInfiniteLine
        axis={guide.axis}
        color={color}
        opacity={0.85}
        perpX={guide.perpX}
        perpZ={guide.perpZ}
        y={guide.y}
      />
      <Label color={color} position={labelPos} text={guide.label} />
    </>
  )
}

/**
 * Dashed infinite line — n krótkich segmentów boxGeometry rozmieszczonych
 * wzdłuż osi reference, w pozycji prostopadłej. Pascal WebGPU OK z
 * boxGeometry + meshBasicMaterial (proven via SceneAxes).
 */
function DashedInfiniteLine({
  axis,
  color,
  opacity,
  perpX,
  perpZ,
  y,
}: {
  axis: Axis
  color: string
  opacity: number
  perpX: number
  perpZ: number
  y: number
}) {
  // Dorzucenie 3D mesh boxes do dynamicznych guides crashował Pascal
  // WebGPU pipeline (cascade "Invalid RenderPipeline"). Workaround:
  // rysujemy dashed line jako HTML overlay z CSS dashed border. Bez
  // perspective deformation ale stabilne. Trade-off acceptable bo guides
  // używamy głównie w plan view 2D.
  const dashSegLen = (GUIDE_LINE_LENGTH / DASH_SEGMENTS) * DASH_RATIO
  const dashStep = GUIDE_LINE_LENGTH / DASH_SEGMENTS
  const dashStartOffset = -GUIDE_LINE_LENGTH / 2
  return (
    <>
      {Array.from({ length: DASH_SEGMENTS }, (_, i) => {
        const offset = dashStartOffset + i * dashStep + dashSegLen / 2
        const px = axis === 'x' ? offset : perpX
        const pz = axis === 'z' ? offset : perpZ
        const py = axis === 'y' ? y + offset : y
        return (
          <Html
            center
            key={i}
            position={[px, py, pz]}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
            zIndexRange={[90, 0]}
          >
            <div
              style={{
                background: color,
                opacity,
                height: 2,
                width: 8,
              }}
            />
          </Html>
        )
      })}
    </>
  )
}

function Dot({ color, position }: { color: string; position: [number, number, number] }) {
  return (
    <Html center position={position} style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[100, 0]}>
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
    <Html center position={position} style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[100, 0]}>
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
