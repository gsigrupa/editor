'use client'

import { emitter, type GridEvent, type LevelNode, type SiteNode, type WallNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Raycaster, Vector2, Vector3 } from 'three'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'

type Phase = 'idle' | 'dragging'
type ToolMode = 'measure' | 'guide'
type Axis = 'x' | 'y' | 'z'
type AxisLock = Axis | null
type SnapType =
  | 'origin'
  | 'endpoint'
  | 'midpoint'
  | 'edge'
  | 'wall-face'
  | 'axis-x'
  | 'axis-y'
  | 'axis-z'
  | 'guide-point'
  | 'guide-line'
  | 'vertical-guide'
  | 'measurement-endpoint'
  | 'empty'
type GuideKind = 'point' | 'line' | 'vertical'
type DeleteTargetKind = 'guide' | 'measurement'

interface MeasurePoint {
  x: number
  y: number
  z: number
}

interface LineRef {
  origin: [number, number]
  direction: [number, number]
}

interface SnapResult {
  type: SnapType
  point: MeasurePoint
  label: string
  color: string
  line?: LineRef
  axis?: Axis
  deleteTarget?: { kind: DeleteTargetKind; id: string }
}

type Guide =
  | {
      id: string
      kind: 'point'
      point: MeasurePoint
      label: string
    }
  | {
      id: string
      kind: 'line'
      line: LineRef
      offset: number
      y: number
      color: string
      label: string
    }
  | {
      id: string
      kind: 'vertical'
      x: number
      z: number
      y: number
      height: number
      color: string
      label: string
    }

interface Measurement {
  id: string
  start: MeasurePoint
  end: MeasurePoint
  label: string
}

interface Draft {
  start: MeasurePoint
  snap: SnapResult
  mode: ToolMode
}

interface AxisInference {
  axis: Axis
  point: MeasurePoint
  color: string
}

const SNAP_POINT_RADIUS = 0.4
const SNAP_LINE_RADIUS = 0.5
const SNAP_WALL_FACE_RADIUS = 0.22
const Y_AXIS_RAY_RADIUS = 0.18
const AXIS_INFERENCE_RADIUS = 0.25
const LINE_THICKNESS = 0.01
const GUIDE_LINE_LENGTH = 200
const VERTICAL_GUIDE_HEIGHT = 8
const DASH_COUNT = 240
const VERTICAL_DASH_COUNT = 80
const HUD_OFFSET = 0.02
const SNAP_MARKER_SIZE = 14
const SNAP_MARKER_ELEVATION = 1
const SNAP_STEM_THICKNESS = 0.006

const COLOR_X = '#ef4444'
const COLOR_Y = '#22c55e'
const COLOR_Z = '#3b82f6'
const COLOR_ENDPOINT = '#22c55e'
const COLOR_MIDPOINT = '#06b6d4'
const COLOR_EDGE = '#ef4444'
const COLOR_ORIGIN = '#eab308'
const COLOR_MEASURE = '#6b7280'
const COLOR_GUIDE = '#0f172a'
const COLOR_WALL_GUIDE = '#a855f7'
const COLOR_SHADOW = '#ffffff'
const DEFAULT_MODE: ToolMode = 'guide'

const guides: Guide[] = []
const measurements: Measurement[] = []
const subscribers = new Set<() => void>()

function subscribe(cb: () => void) {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

function notify() {
  for (const cb of subscribers) cb()
}

function newId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function getSiteCorner(): [number, number] {
  const { nodes, rootNodeIds } = useScene.getState()
  const root = rootNodeIds[0] ? nodes[rootNodeIds[0]] : null
  if (!root || root.type !== 'site') return [0, 0]

  const points = (root as SiteNode).polygon?.points
  const first = points?.[0]
  if (!points || !first) return [0, 0]

  let minX = first[0]
  let minZ = first[1]
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
  }
  return [minX, minZ]
}

function getCurrentLevelWalls(): WallNode[] {
  const levelId = useViewer.getState().selection.levelId
  const { nodes } = useScene.getState()
  if (!levelId) return []

  const level = nodes[levelId]
  if (!level || level.type !== 'level') return []

  return (level as LevelNode).children
    .map((childId) => nodes[childId])
    .filter((node): node is WallNode => node?.type === 'wall')
}

function formatLength(meters: number): string {
  const unit = useViewer.getState().lengthUnit
  if (unit === 'mm') return `${(meters * 1000).toFixed(0)} mm`
  if (unit === 'cm') return `${(meters * 100).toFixed(1)} cm`
  return `${meters.toFixed(2)} m`
}

function parseLength(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized || normalized === '.') return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return null

  const unit = useViewer.getState().lengthUnit
  if (unit === 'mm') return parsed / 1000
  if (unit === 'cm') return parsed / 100
  return parsed
}

function distance2(a: [number, number], b: [number, number]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function distance3(a: MeasurePoint, b: MeasurePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function normalizeLine(start: [number, number], end: [number, number]): LineRef | null {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return null
  return { origin: start, direction: [dx / len, dz / len] }
}

function offsetLine(line: LineRef, offset: number): LineRef {
  return {
    origin: [
      line.origin[0] + -line.direction[1] * offset,
      line.origin[1] + line.direction[0] * offset,
    ],
    direction: line.direction,
  }
}

function signedOffset(point: [number, number], line: LineRef): number {
  const dx = point[0] - line.origin[0]
  const dz = point[1] - line.origin[1]
  return dx * -line.direction[1] + dz * line.direction[0]
}

function projectToSegment(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): { distance: number; rawT: number; t: number; point: [number, number] } {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lenSq = dx * dx + dz * dz
  if (lenSq < 1e-9) return { distance: distance2(point, start), rawT: 0, t: 0, point: start }

  const rawT = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lenSq
  const t = Math.max(0, Math.min(1, rawT))
  const projected: [number, number] = [start[0] + dx * t, start[1] + dz * t]
  return { distance: distance2(point, projected), rawT, t, point: projected }
}

function projectToLine(point: [number, number], line: LineRef): [number, number] {
  const offset = signedOffset(point, line)
  return [
    point[0] - -line.direction[1] * offset,
    point[1] - line.direction[0] * offset,
  ]
}

function scalePoint(start: MeasurePoint, end: MeasurePoint, length: number): MeasurePoint {
  const current = distance3(start, end)
  if (current < 1e-6) return end
  const scale = length / current
  return {
    x: start.x + (end.x - start.x) * scale,
    y: start.y + (end.y - start.y) * scale,
    z: start.z + (end.z - start.z) * scale,
  }
}

function axisColor(axis: Axis) {
  if (axis === 'x') return COLOR_X
  if (axis === 'y') return COLOR_Y
  return COLOR_Z
}

function axisName(axis: Axis) {
  if (axis === 'x') return 'X'
  if (axis === 'y') return 'Y'
  return 'Z'
}

function axisLine(axis: Exclude<Axis, 'y'>): LineRef {
  const siteCorner = getSiteCorner()
  return axis === 'x'
    ? { origin: siteCorner, direction: [1, 0] }
    : { origin: siteCorner, direction: [0, 1] }
}

function lockPointToAxis(start: MeasurePoint, cursor: MeasurePoint, axis: Axis): MeasurePoint {
  if (axis === 'x') return { x: cursor.x, y: start.y, z: start.z }
  if (axis === 'y') return { x: start.x, y: cursor.y, z: start.z }
  return { x: start.x, y: start.y, z: cursor.z }
}

function targetPointFromLength(start: MeasurePoint, cursor: MeasurePoint, typedLength: number | null): MeasurePoint {
  if (typedLength === null) return cursor
  const dx = cursor.x - start.x
  const dz = cursor.z - start.z
  const distance = Math.hypot(dx, dz)
  if (distance < 1e-6) return cursor
  return {
    x: start.x + (dx / distance) * typedLength,
    y: cursor.y,
    z: start.z + (dz / distance) * typedLength,
  }
}

function makeYAxisSnap(y = 0): SnapResult {
  const siteCorner = getSiteCorner()
  return {
    type: 'axis-y',
    point: { x: siteCorner[0], y, z: siteCorner[1] },
    label: 'Oś Y',
    color: COLOR_Y,
    axis: 'y',
  }
}

function detectSnap(raw: MeasurePoint): SnapResult {
  const walls = getCurrentLevelWalls()
  const siteCorner = getSiteCorner()
  const point: [number, number] = [raw.x, raw.z]

  if (distance2(point, siteCorner) < SNAP_POINT_RADIUS) {
    return makeYAxisSnap(raw.y)
  }

  for (const guide of guides) {
    if (guide.kind === 'point' && distance2(point, [guide.point.x, guide.point.z]) < SNAP_POINT_RADIUS) {
      return {
        type: 'guide-point',
        point: guide.point,
        label: 'Guide Point · Del = usuń',
        color: COLOR_ENDPOINT,
        deleteTarget: { kind: 'guide', id: guide.id },
      }
    }

    if (guide.kind === 'vertical' && distance2(point, [guide.x, guide.z]) < SNAP_POINT_RADIUS) {
      return {
        type: 'vertical-guide',
        point: { x: guide.x, y: raw.y, z: guide.z },
        label: 'Vertical Guide · Del = usuń',
        color: COLOR_Y,
        axis: 'y',
        deleteTarget: { kind: 'guide', id: guide.id },
      }
    }

    if (guide.kind === 'line') {
      const lineOrigin: [number, number] = [
        guide.line.origin[0] + -guide.line.direction[1] * guide.offset,
        guide.line.origin[1] + guide.line.direction[0] * guide.offset,
      ]
      const line = { origin: lineOrigin, direction: guide.line.direction }
      const offset = signedOffset(point, line)
      if (Math.abs(offset) < SNAP_LINE_RADIUS) {
        const projected = projectToLine(point, line)
        return {
          type: 'guide-line',
          point: { x: projected[0], y: raw.y, z: projected[1] },
          label: 'Guide Line · Del = usuń',
          color: COLOR_EDGE,
          line,
          deleteTarget: { kind: 'guide', id: guide.id },
        }
      }
    }
  }

  for (const measurement of measurements) {
    for (const endpoint of [measurement.start, measurement.end]) {
      if (distance2(point, [endpoint.x, endpoint.z]) < SNAP_POINT_RADIUS) {
        return {
          type: 'measurement-endpoint',
          point: endpoint,
          label: 'Pomiar · Del = usuń',
          color: COLOR_ENDPOINT,
          deleteTarget: { kind: 'measurement', id: measurement.id },
        }
      }
    }
  }

  let bestFaceEndpoint: { distance: number; point: MeasurePoint; line: LineRef } | null = null
  let bestFace: { distance: number; point: MeasurePoint; line: LineRef } | null = null
  for (const wall of walls) {
    const centerLine = normalizeLine(wall.start, wall.end)
    if (!centerLine) continue

    const projectedOnCenter = projectToSegment(point, wall.start, wall.end)
    const halfThickness = (wall.thickness ?? 0.25) / 2
    for (const side of [-1, 1]) {
      const faceLine = offsetLine(centerLine, side * halfThickness)
      const faceStart = faceLine.origin
      const faceEnd: [number, number] = [
        faceLine.origin[0] + faceLine.direction[0] * distance2(wall.start, wall.end),
        faceLine.origin[1] + faceLine.direction[1] * distance2(wall.start, wall.end),
      ]

      for (const endpoint of [faceStart, faceEnd]) {
        const d = distance2(point, endpoint)
        if (d < SNAP_POINT_RADIUS && (!bestFaceEndpoint || d < bestFaceEndpoint.distance)) {
          bestFaceEndpoint = {
            distance: d,
            point: { x: endpoint[0], y: raw.y, z: endpoint[1] },
            line: faceLine,
          }
        }
      }

      const projectedOnFace = projectToLine(point, faceLine)
      const distanceToFace = Math.abs(signedOffset(point, faceLine))
      const withinSegment = projectedOnCenter.rawT >= 0 && projectedOnCenter.rawT <= 1
      if (
        withinSegment &&
        distanceToFace < SNAP_WALL_FACE_RADIUS &&
        (!bestFace || distanceToFace < bestFace.distance)
      ) {
        bestFace = {
          distance: distanceToFace,
          point: { x: projectedOnFace[0], y: raw.y, z: projectedOnFace[1] },
          line: faceLine,
        }
      }
    }
  }
  if (bestFaceEndpoint) {
    return {
      type: 'wall-face',
      point: bestFaceEndpoint.point,
      label: 'Wall Face Endpoint',
      color: COLOR_ENDPOINT,
      line: bestFaceEndpoint.line,
    }
  }
  if (bestFace) {
    return {
      type: 'wall-face',
      point: bestFace.point,
      label: 'Wall Face',
      color: COLOR_EDGE,
      line: bestFace.line,
    }
  }

  let bestEndpoint: { distance: number; point: MeasurePoint } | null = null
  for (const wall of walls) {
    for (const endpoint of [wall.start, wall.end]) {
      const d = distance2(point, endpoint)
      if (d < SNAP_POINT_RADIUS && (!bestEndpoint || d < bestEndpoint.distance)) {
        bestEndpoint = { distance: d, point: { x: endpoint[0], y: raw.y, z: endpoint[1] } }
      }
    }
  }
  if (bestEndpoint) {
    return { type: 'endpoint', point: bestEndpoint.point, label: 'Endpoint', color: COLOR_ENDPOINT }
  }

  let bestMidpoint: { distance: number; point: MeasurePoint } | null = null
  for (const wall of walls) {
    const midpoint: [number, number] = [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2]
    const d = distance2(point, midpoint)
    if (d < SNAP_POINT_RADIUS && (!bestMidpoint || d < bestMidpoint.distance)) {
      bestMidpoint = { distance: d, point: { x: midpoint[0], y: raw.y, z: midpoint[1] } }
    }
  }
  if (bestMidpoint) {
    return { type: 'midpoint', point: bestMidpoint.point, label: 'Midpoint', color: COLOR_MIDPOINT }
  }

  let bestEdge: { distance: number; point: MeasurePoint; line: LineRef } | null = null
  for (const wall of walls) {
    const projected = projectToSegment(point, wall.start, wall.end)
    const line = normalizeLine(wall.start, wall.end)
    if (line && projected.distance < SNAP_LINE_RADIUS && (!bestEdge || projected.distance < bestEdge.distance)) {
      bestEdge = {
        distance: projected.distance,
        point: { x: projected.point[0], y: raw.y, z: projected.point[1] },
        line,
      }
    }
  }
  if (bestEdge) {
    return { type: 'edge', point: bestEdge.point, label: 'On Edge', color: COLOR_EDGE, line: bestEdge.line }
  }

  const [cornerX, cornerZ] = siteCorner
  const distToX = Math.abs(raw.z - cornerZ)
  const distToZ = Math.abs(raw.x - cornerX)
  if (distToX < SNAP_LINE_RADIUS && distToX <= distToZ) {
    return {
      type: 'axis-x',
      point: { x: raw.x, y: raw.y, z: cornerZ },
      label: 'Oś X',
      color: COLOR_X,
      line: { origin: siteCorner, direction: [1, 0] },
      axis: 'x',
    }
  }
  if (distToZ < SNAP_LINE_RADIUS) {
    return {
      type: 'axis-z',
      point: { x: cornerX, y: raw.y, z: raw.z },
      label: 'Oś Z',
      color: COLOR_Z,
      line: { origin: siteCorner, direction: [0, 1] },
      axis: 'z',
    }
  }

  return { type: 'empty', point: raw, label: '', color: COLOR_MEASURE }
}

function inferAxis(start: MeasurePoint, cursor: MeasurePoint): AxisInference | null {
  const dx = cursor.x - start.x
  const dy = cursor.y - start.y
  const dz = cursor.z - start.z

  const nearX = Math.hypot(dy, dz)
  const nearY = Math.hypot(dx, dz)
  const nearZ = Math.hypot(dx, dy)

  if (nearX < AXIS_INFERENCE_RADIUS && nearX <= nearY && nearX <= nearZ) {
    return { axis: 'x', point: { x: cursor.x, y: start.y, z: start.z }, color: COLOR_X }
  }
  if (nearY < AXIS_INFERENCE_RADIUS && nearY <= nearZ) {
    return { axis: 'y', point: { x: start.x, y: cursor.y, z: start.z }, color: COLOR_Y }
  }
  if (nearZ < AXIS_INFERENCE_RADIUS) {
    return { axis: 'z', point: { x: start.x, y: start.y, z: cursor.z }, color: COLOR_Z }
  }
  return null
}

function commitAxisGuide(draft: Draft, cursor: MeasurePoint, typedLength: number | null, axis: Axis) {
  const target = targetPointFromLength(draft.start, cursor, typedLength)

  if (axis === 'y') {
    const distance = Math.hypot(target.x - draft.start.x, target.z - draft.start.z)
    if (distance < 0.001) return
    guides.push({
      id: newId('guide'),
      kind: 'vertical',
      x: target.x,
      z: target.z,
      y: draft.start.y,
      height: VERTICAL_GUIDE_HEIGHT,
      color: COLOR_GUIDE,
      label: 'Oś Y',
    })
    notify()
    return
  }

  const line = axisLine(axis)
  const offset = signedOffset([target.x, target.z], line)
  if (Math.abs(offset) < 0.001) return

  guides.push({
    id: newId('guide'),
    kind: 'line',
    line,
    offset,
    y: draft.start.y,
    color: COLOR_GUIDE,
    label: formatLength(Math.abs(offset)),
  })
  notify()
}

function commitDraft(draft: Draft, cursor: MeasurePoint, typedLength: number | null, axisLock: AxisLock) {
  if (draft.mode === 'measure') {
    const lockedCursor = axisLock ? lockPointToAxis(draft.start, cursor, axisLock) : cursor
    const length = typedLength ?? distance3(draft.start, lockedCursor)
    if (length < 0.001) return

    const end = typedLength !== null ? scalePoint(draft.start, lockedCursor, typedLength) : lockedCursor
    measurements.push({
      id: newId('measure'),
      start: draft.start,
      end,
      label: formatLength(length),
    })
    notify()
    return
  }

  if (axisLock) {
    commitAxisGuide(draft, cursor, typedLength, axisLock)
    return
  }

  if (draft.snap.type === 'axis-y' || draft.snap.type === 'vertical-guide') {
    const distance = Math.hypot(cursor.x - draft.start.x, cursor.z - draft.start.z)
    const direction =
      distance > 1e-6
        ? {
            x: (cursor.x - draft.start.x) / distance,
            z: (cursor.z - draft.start.z) / distance,
          }
        : { x: 1, z: 0 }
    const targetDistance = typedLength ?? distance
    const targetX = draft.snap.type === 'vertical-guide'
      ? draft.start.x
      : draft.start.x + direction.x * targetDistance
    const targetZ = draft.snap.type === 'vertical-guide'
      ? draft.start.z
      : draft.start.z + direction.z * targetDistance

    if (draft.snap.type === 'axis-y' && targetDistance < 0.001) return

    guides.push({
      id: newId('guide'),
      kind: 'vertical',
      x: targetX,
      z: targetZ,
      y: draft.start.y,
      height: VERTICAL_GUIDE_HEIGHT,
      color: COLOR_GUIDE,
      label: 'Oś Y',
    })
    notify()
    return
  }

  if (draft.snap.line) {
    const offset = signedOffset([cursor.x, cursor.z], draft.snap.line)
    const signedLength = typedLength !== null ? Math.sign(offset || 1) * typedLength : offset
    if (Math.abs(signedLength) < 0.001) return

    guides.push({
      id: newId('guide'),
      kind: 'line',
      line: draft.snap.line,
      offset: signedLength,
      y: draft.start.y,
      color: draft.snap.axis ? COLOR_GUIDE : COLOR_WALL_GUIDE,
      label: formatLength(Math.abs(signedLength)),
    })
    notify()
    return
  }

  const length = typedLength ?? distance3(draft.start, cursor)
  if (length < 0.001) return

  guides.push({
    id: newId('guide'),
    kind: 'point',
    point: typedLength !== null ? scalePoint(draft.start, cursor, typedLength) : cursor,
    label: formatLength(length),
  })
  notify()
}

function deleteTarget(target: { kind: DeleteTargetKind; id: string }) {
  if (target.kind === 'guide') {
    const index = guides.findIndex((guide) => guide.id === target.id)
    if (index >= 0) guides.splice(index, 1)
  } else {
    const index = measurements.findIndex((measurement) => measurement.id === target.id)
    if (index >= 0) measurements.splice(index, 1)
  }
  notify()
}

interface GuideHit {
  guide: Guide
  point: MeasurePoint
  label: string
}

function findGuideAtPoint(point: MeasurePoint): GuideHit | null {
  const p: [number, number] = [point.x, point.z]
  let best: { distance: number; hit: GuideHit } | null = null

  for (const guide of guides) {
    if (guide.kind === 'point') {
      const distance = distance2(p, [guide.point.x, guide.point.z])
      if (distance < SNAP_POINT_RADIUS && (!best || distance < best.distance)) {
        best = {
          distance,
          hit: { guide, point: guide.point, label: 'Guide Point' },
        }
      }
      continue
    }

    if (guide.kind === 'vertical') {
      const distance = distance2(p, [guide.x, guide.z])
      if (distance < SNAP_POINT_RADIUS && (!best || distance < best.distance)) {
        best = {
          distance,
          hit: {
            guide,
            point: { x: guide.x, y: point.y, z: guide.z },
            label: 'Vertical Guide',
          },
        }
      }
      continue
    }

    const line = offsetLine(guide.line, guide.offset)
    const distance = Math.abs(signedOffset(p, line))
    if (distance < SNAP_LINE_RADIUS && (!best || distance < best.distance)) {
      const projected = projectToLine(p, line)
      best = {
        distance,
        hit: {
          guide,
          point: { x: projected[0], y: guide.y, z: projected[1] },
          label: 'Guide Line',
        },
      }
    }
  }

  return best?.hit ?? null
}

function deleteGuide(id: string) {
  const index = guides.findIndex((guide) => guide.id === id)
  if (index < 0) return
  guides.splice(index, 1)
  notify()
}

export const MeasureTool: React.FC = () => {
  const { camera, gl } = useThree()
  const [version, setVersion] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<ToolMode>(DEFAULT_MODE)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [hoverSnap, setHoverSnap] = useState<SnapResult | null>(null)
  const [cursor, setCursor] = useState<MeasurePoint | null>(null)
  const [inference, setInference] = useState<AxisInference | null>(null)
  const [axisLock, setAxisLock] = useState<AxisLock>(null)
  const [pendingLength, setPendingLength] = useState('')

  const phaseRef = useRef<Phase>('idle')
  const modeRef = useRef<ToolMode>(DEFAULT_MODE)
  const draftRef = useRef<Draft | null>(null)
  const cursorRef = useRef<MeasurePoint | null>(null)
  const hoverSnapRef = useRef<SnapResult | null>(null)
  const axisLockRef = useRef<AxisLock>(null)
  const pendingLengthRef = useRef('')
  const raycasterRef = useRef(new Raycaster())
  const pointerRef = useRef(new Vector2())
  const rayPointRef = useRef(new Vector3())
  const axisPointRef = useRef(new Vector3())

  phaseRef.current = phase
  modeRef.current = mode
  draftRef.current = draft
  cursorRef.current = cursor
  hoverSnapRef.current = hoverSnap
  axisLockRef.current = axisLock

  useEffect(() => subscribe(() => setVersion((value) => value + 1)), [])
  void version

  useEffect(() => {
    const resetDraft = () => {
      draftRef.current = null
      cursorRef.current = null
      pendingLengthRef.current = ''
      setDraft(null)
      setCursor(null)
      setInference(null)
      setAxisLock(null)
      setPendingLength('')
      setPhase('idle')
    }

    const readCursor = (event: GridEvent): MeasurePoint => {
      return { x: event.localPosition[0], y: event.localPosition[1], z: event.localPosition[2] }
    }

    const getYAxisPointerSnap = (event: GridEvent): SnapResult | null => {
      const nativeEvent = event.nativeEvent as unknown as PointerEvent | MouseEvent | undefined
      if (!nativeEvent) return null

      const rect = gl.domElement.getBoundingClientRect()
      pointerRef.current.x = ((nativeEvent.clientX - rect.left) / rect.width) * 2 - 1
      pointerRef.current.y = -((nativeEvent.clientY - rect.top) / rect.height) * 2 + 1
      raycasterRef.current.setFromCamera(pointerRef.current, camera)

      const [cornerX, cornerZ] = getSiteCorner()
      const start = new Vector3(cornerX, 0, cornerZ)
      const end = new Vector3(cornerX, VERTICAL_GUIDE_HEIGHT, cornerZ)
      const distanceSq = raycasterRef.current.ray.distanceSqToSegment(
        start,
        end,
        rayPointRef.current,
        axisPointRef.current,
      )

      if (distanceSq > Y_AXIS_RAY_RADIUS * Y_AXIS_RAY_RADIUS) return null
      return makeYAxisSnap(axisPointRef.current.y)
    }

    const updateCursor = (event: GridEvent) => {
      const raw = readCursor(event)
      const currentDraft = draftRef.current
      const snap = !currentDraft ? (getYAxisPointerSnap(event) ?? detectSnap(raw)) : detectSnap(raw)
      let nextCursor = snap.point
      let nextInference: AxisInference | null = null

      if (currentDraft) {
        const lockedAxis = axisLockRef.current
        if (lockedAxis) {
          nextInference = {
            axis: lockedAxis,
            point: currentDraft.mode === 'measure'
              ? lockPointToAxis(currentDraft.start, nextCursor, lockedAxis)
              : nextCursor,
            color: axisColor(lockedAxis),
          }
          if (currentDraft.mode === 'measure') nextCursor = nextInference.point
        } else {
          nextInference = inferAxis(currentDraft.start, nextCursor)
          if (nextInference) nextCursor = nextInference.point
        }
      }

      hoverSnapRef.current = snap
      cursorRef.current = nextCursor
      setHoverSnap(snap)
      setCursor(nextCursor)
      setInference(nextInference)
    }

    const onMove = (event: GridEvent) => {
      updateCursor(event)
    }

    const onClick = (event: GridEvent) => {
      const raw = readCursor(event)
      const snap = phaseRef.current === 'idle'
        ? (getYAxisPointerSnap(event) ?? detectSnap(raw))
        : detectSnap(raw)

      if (phaseRef.current === 'idle') {
        const nextDraft = { start: snap.point, snap, mode: modeRef.current }
        draftRef.current = nextDraft
        cursorRef.current = snap.point
        setDraft(nextDraft)
        setCursor(snap.point)
        setHoverSnap(snap)
        setInference(null)
        setPhase('dragging')
        return
      }

      let finalCursor = snap.point
      const currentDraft = draftRef.current
      if (!currentDraft) return

      const lockedAxis = axisLockRef.current
      if (lockedAxis && currentDraft.mode === 'measure') {
        finalCursor = lockPointToAxis(currentDraft.start, finalCursor, lockedAxis)
      } else if (!lockedAxis) {
        const axis = inferAxis(currentDraft.start, finalCursor)
        if (axis) finalCursor = axis.point
      }
      commitDraft(currentDraft, finalCursor, parseLength(pendingLengthRef.current), lockedAxis)
      resetDraft()
    }

    const onCancel = () => {
      if (phaseRef.current === 'dragging') {
        markToolCancelConsumed()
        resetDraft()
      }
    }

    const toggleMode = () => {
      const nextMode: ToolMode = modeRef.current === 'measure' ? 'guide' : 'measure'
      modeRef.current = nextMode
      setMode(nextMode)

      const currentDraft = draftRef.current
      if (currentDraft) {
        const nextDraft = { ...currentDraft, mode: nextMode }
        draftRef.current = nextDraft
        setDraft(nextDraft)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (phaseRef.current === 'dragging') {
        const axisFromKey =
          event.key === 'ArrowRight'
            ? 'x'
            : event.key === 'ArrowLeft'
              ? 'y'
              : event.key === 'ArrowUp'
                ? 'z'
                : null
        if (axisFromKey) {
          axisLockRef.current = axisFromKey
          setAxisLock(axisFromKey)
          setInference((current) => ({
            axis: axisFromKey,
            point: current?.point ?? cursorRef.current ?? draftRef.current?.start ?? { x: 0, y: 0, z: 0 },
            color: axisColor(axisFromKey),
          }))
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
        if (event.key === 'ArrowDown') {
          axisLockRef.current = null
          setAxisLock(null)
          setInference(null)
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
      }

      if (event.key === 'Control' || event.key === 'Meta') {
        if (event.repeat) return
        toggleMode()
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      if ((event.key === 'y' || event.key === 'Y') && !event.ctrlKey && !event.metaKey) {
        guides.length = 0
        measurements.length = 0
        notify()
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      if (phaseRef.current === 'idle' && (event.key === 'Delete' || event.key === 'Backspace')) {
        const target = hoverSnapRef.current?.deleteTarget
        if (target) {
          deleteTarget(target)
          setHoverSnap(null)
          hoverSnapRef.current = null
          event.preventDefault()
          event.stopImmediatePropagation()
          return
        }
      }

      if (phaseRef.current !== 'dragging') return

      if (event.key >= '0' && event.key <= '9') {
        pendingLengthRef.current += event.key
        setPendingLength(pendingLengthRef.current)
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      if ((event.key === '.' || event.key === ',') && !pendingLengthRef.current.includes('.')) {
        pendingLengthRef.current += '.'
        setPendingLength(pendingLengthRef.current)
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      if (event.key === 'Backspace' && pendingLengthRef.current.length > 0) {
        pendingLengthRef.current = pendingLengthRef.current.slice(0, -1)
        setPendingLength(pendingLengthRef.current)
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }

      if (event.key === 'Enter') {
        const currentDraft = draftRef.current
        const currentCursor = cursorRef.current
        const typed = parseLength(pendingLengthRef.current)
        if (currentDraft && currentCursor && typed !== null) {
          commitDraft(currentDraft, currentCursor, typed, axisLockRef.current)
          resetDraft()
          event.preventDefault()
          event.stopImmediatePropagation()
        }
      }
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown, { capture: true })

    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [camera, gl])

  const liveDistance = draft && cursor ? getLiveDistance(draft, cursor, pendingLength, axisLock) : null
  const preview = draft && cursor ? getPreview(draft, cursor, pendingLength, axisLock) : null

  return (
    <>
      {preview?.kind === 'segment' && <SegmentLine color={preview.color} end={preview.end} start={preview.start} />}
      {preview?.kind === 'line' && (
        <InfiniteGuideLine color={preview.color} label={preview.label} line={preview.line} offset={preview.offset} y={preview.y} />
      )}
      {preview?.kind === 'vertical' && (
        <VerticalGuideLine color={preview.color} height={preview.height} label={preview.label} x={preview.x} y={preview.y} z={preview.z} />
      )}

      {hoverSnap && hoverSnap.type !== 'empty' && <SnapMarker snap={hoverSnap} />}

      <Html fullscreen style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[100, 0]}>
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            left: 16,
            background: (draft?.mode ?? mode) === 'guide' ? '#dc2626cc' : '#0ea5e9cc',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          {(draft?.mode ?? mode) === 'guide' ? 'GUIDE' : 'POMIAR'}
          {' · Ctrl = guide toggle · Y = wyczyść'}
          {hoverSnap?.label ? ` · ${hoverSnap.label}` : ''}
          {axisLock ? ` · blokada ${axisName(axisLock)}` : ''}
          {inference ? ` · oś ${inference.axis.toUpperCase()}` : ''}
        </div>

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
            {(draft?.mode ?? mode) === 'guide' ? 'Guide' : 'Pomiar'}
          </span>
          <span style={{ minWidth: 80, textAlign: 'right', color: pendingLength ? '#dc2626' : undefined }}>
            {pendingLength
              ? `${pendingLength} ${useViewer.getState().lengthUnit}`
              : liveDistance !== null
                ? formatLength(liveDistance)
                : '-'}
          </span>
        </div>
      </Html>
    </>
  )
}

export const EraserTool: React.FC = () => {
  const [version, setVersion] = useState(0)
  const [hoverHit, setHoverHit] = useState<GuideHit | null>(null)
  const hoverHitRef = useRef<GuideHit | null>(null)

  hoverHitRef.current = hoverHit

  useEffect(() => subscribe(() => setVersion((value) => value + 1)), [])
  void version

  useEffect(() => {
    const readCursor = (event: GridEvent): MeasurePoint => ({
      x: event.localPosition[0],
      y: event.localPosition[1],
      z: event.localPosition[2],
    })

    const onMove = (event: GridEvent) => {
      const hit = findGuideAtPoint(readCursor(event))
      hoverHitRef.current = hit
      setHoverHit(hit)
    }

    const onClick = (event: GridEvent) => {
      const hit = hoverHitRef.current ?? findGuideAtPoint(readCursor(event))
      if (!hit) return
      deleteGuide(hit.guide.id)
      hoverHitRef.current = null
      setHoverHit(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
    }
  }, [])

  return (
    <>
      {hoverHit ? <EraserMarker hit={hoverHit} /> : null}
      <Html fullscreen style={{ pointerEvents: 'none', userSelect: 'none' }} zIndexRange={[100, 0]}>
        <div
          style={{
            position: 'absolute',
            bottom: 90,
            left: 16,
            background: '#ef4444cc',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          GUMKA · kliknij guide żeby usunąć
          {hoverHit ? ` · ${hoverHit.label}` : ''}
        </div>
      </Html>
    </>
  )
}

function getLiveDistance(draft: Draft, cursor: MeasurePoint, pendingLength: string, axisLock: AxisLock) {
  const typed = parseLength(pendingLength)
  if (typed !== null) return typed
  if (axisLock) {
    if (draft.mode === 'guide' && axisLock !== 'y') {
      return Math.abs(signedOffset([cursor.x, cursor.z], axisLine(axisLock)))
    }
    if (draft.mode === 'guide' && axisLock === 'y') {
      return Math.hypot(cursor.x - draft.start.x, cursor.z - draft.start.z)
    }
    return distance3(draft.start, lockPointToAxis(draft.start, cursor, axisLock))
  }
  if (draft.mode === 'guide' && draft.snap.line) {
    return Math.abs(signedOffset([cursor.x, cursor.z], draft.snap.line))
  }
  return distance3(draft.start, cursor)
}

type Preview =
  | { kind: 'segment'; start: MeasurePoint; end: MeasurePoint; color: string }
  | { kind: 'line'; line: LineRef; offset: number; y: number; color: string; label: string }
  | { kind: 'vertical'; x: number; y: number; z: number; height: number; color: string; label: string }

function getAxisGuidePreview(draft: Draft, cursor: MeasurePoint, pendingLength: string, axis: Axis): Preview {
  const typed = parseLength(pendingLength)
  const target = targetPointFromLength(draft.start, cursor, typed)

  if (axis === 'y') {
    return {
      kind: 'vertical',
      x: target.x,
      y: draft.start.y,
      z: target.z,
      height: VERTICAL_GUIDE_HEIGHT,
      color: COLOR_GUIDE,
      label: 'Oś Y',
    }
  }

  const line = axisLine(axis)
  const offset = signedOffset([target.x, target.z], line)
  return {
    kind: 'line',
    line,
    offset,
    y: draft.start.y,
    color: COLOR_GUIDE,
    label: formatLength(Math.abs(offset)),
  }
}

function getPreview(draft: Draft, cursor: MeasurePoint, pendingLength: string, axisLock: AxisLock): Preview {
  const typed = parseLength(pendingLength)

  if (draft.mode === 'guide' && axisLock) {
    return getAxisGuidePreview(draft, cursor, pendingLength, axisLock)
  }

  if (draft.mode === 'guide' && (draft.snap.type === 'axis-y' || draft.snap.type === 'vertical-guide')) {
    const distance = Math.hypot(cursor.x - draft.start.x, cursor.z - draft.start.z)
    const direction =
      distance > 1e-6
        ? {
            x: (cursor.x - draft.start.x) / distance,
            z: (cursor.z - draft.start.z) / distance,
          }
        : { x: 1, z: 0 }
    const targetDistance = typed ?? distance
    const x = draft.snap.type === 'vertical-guide'
      ? draft.start.x
      : draft.start.x + direction.x * targetDistance
    const z = draft.snap.type === 'vertical-guide'
      ? draft.start.z
      : draft.start.z + direction.z * targetDistance

    return {
      kind: 'vertical',
      x,
      y: draft.start.y,
      z,
      height: VERTICAL_GUIDE_HEIGHT,
      color: COLOR_GUIDE,
      label: 'Oś Y',
    }
  }

  if (draft.mode === 'guide' && draft.snap.line) {
    const rawOffset = signedOffset([cursor.x, cursor.z], draft.snap.line)
    const offset = typed !== null ? Math.sign(rawOffset || 1) * typed : rawOffset
    return {
      kind: 'line',
      line: draft.snap.line,
      offset,
      y: draft.start.y,
      color: draft.snap.axis ? COLOR_GUIDE : COLOR_WALL_GUIDE,
      label: formatLength(Math.abs(offset)),
    }
  }

  return {
    kind: 'segment',
    start: draft.start,
    end: typed !== null
      ? scalePoint(draft.start, axisLock ? lockPointToAxis(draft.start, cursor, axisLock) : cursor, typed)
      : axisLock
        ? lockPointToAxis(draft.start, cursor, axisLock)
        : cursor,
    color: draft.mode === 'guide'
      ? COLOR_GUIDE
      : axisLock
        ? axisColor(axisLock)
        : (draft.snap.axis ? axisColor(draft.snap.axis) : COLOR_MEASURE),
  }
}

export const MeasureOverlay: React.FC = () => {
  const [version, setVersion] = useState(0)
  useEffect(() => subscribe(() => setVersion((value) => value + 1)), [])
  void version

  return (
    <>
      {guides.map((guide) => {
        if (guide.kind === 'point') return <GuidePointMarker guide={guide} key={guide.id} />
        if (guide.kind === 'vertical') {
          return (
            <VerticalGuideLine
              color={guide.color}
              height={guide.height}
              key={guide.id}
              label={guide.label}
              x={guide.x}
              y={guide.y}
              z={guide.z}
            />
          )
        }
        return (
          <InfiniteGuideLine
            color={guide.color}
            key={guide.id}
            label={guide.label}
            line={guide.line}
            offset={guide.offset}
            y={guide.y}
          />
        )
      })}
      {measurements.map((measurement) => (
        <SegmentLine color={COLOR_MEASURE} end={measurement.end} key={measurement.id} label={measurement.label} start={measurement.start} />
      ))}
    </>
  )
}

function SegmentLine({
  color,
  end,
  label,
  start,
}: {
  color: string
  end: MeasurePoint
  label?: string
  start: MeasurePoint
}) {
  const length = distance3(start, end)
  if (length < 0.001) return null

  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const mid: [number, number, number] = [
    (start.x + end.x) / 2,
    (start.y + end.y) / 2 + HUD_OFFSET,
    (start.z + end.z) / 2,
  ]
  const horizontalLength = Math.hypot(dx, dz)
  if (horizontalLength < 0.001) {
    return (
      <>
        <mesh castShadow={false} position={mid} receiveShadow={false}>
          <boxGeometry args={[LINE_THICKNESS, Math.abs(dy), LINE_THICKNESS]} />
          <meshBasicMaterial color={color} depthTest={false} opacity={0.9} transparent />
        </mesh>
        {label ? <WorldLabel color={color} position={mid} text={label} /> : null}
      </>
    )
  }

  const angleY = Math.atan2(dz, dx)

  return (
    <>
      <mesh castShadow={false} position={mid} receiveShadow={false} rotation={[0, -angleY, 0]}>
        <boxGeometry args={[horizontalLength, LINE_THICKNESS, LINE_THICKNESS]} />
        <meshBasicMaterial color={color} depthTest={false} opacity={0.9} transparent />
      </mesh>
      {label ? <WorldLabel color={color} position={mid} text={label} /> : null}
    </>
  )
}

function InfiniteGuideLine({
  color,
  label,
  line,
  offset,
  y,
}: {
  color: string
  label: string
  line: LineRef
  offset: number
  y: number
}) {
  const baseX = line.origin[0] + -line.direction[1] * offset
  const baseZ = line.origin[1] + line.direction[0] * offset
  const dashLength = GUIDE_LINE_LENGTH / DASH_COUNT / 2
  const step = GUIDE_LINE_LENGTH / DASH_COUNT
  const start = -GUIDE_LINE_LENGTH / 2
  const angleY = Math.atan2(line.direction[1], line.direction[0])

  return (
    <>
      {Array.from({ length: DASH_COUNT }, (_, index) => {
        const t = start + index * step + dashLength / 2
        return (
          <mesh
            castShadow={false}
            key={index}
            position={[baseX + line.direction[0] * t, y + HUD_OFFSET, baseZ + line.direction[1] * t]}
            receiveShadow={false}
            rotation={[0, -angleY, 0]}
          >
            <boxGeometry args={[dashLength, LINE_THICKNESS, LINE_THICKNESS]} />
            <meshBasicMaterial color={color} depthTest={false} opacity={0.8} transparent />
          </mesh>
        )
      })}
      {label ? <WorldLabel color={color} position={[baseX, y + HUD_OFFSET, baseZ]} text={label} /> : null}
    </>
  )
}

function VerticalGuideLine({
  color,
  height,
  label,
  x,
  y,
  z,
}: {
  color: string
  height: number
  label: string
  x: number
  y: number
  z: number
}) {
  const dashLength = height / VERTICAL_DASH_COUNT / 2
  const step = height / VERTICAL_DASH_COUNT

  return (
    <>
      {Array.from({ length: VERTICAL_DASH_COUNT }, (_, index) => (
        <mesh
          castShadow={false}
          key={index}
          position={[x, y + index * step + dashLength / 2, z]}
          receiveShadow={false}
        >
          <boxGeometry args={[LINE_THICKNESS, dashLength, LINE_THICKNESS]} />
          <meshBasicMaterial color={color} depthTest={false} opacity={0.8} transparent />
        </mesh>
      ))}
      {label ? <WorldLabel color={color} position={[x, y + height + HUD_OFFSET, z]} text={label} /> : null}
    </>
  )
}

function GuidePointMarker({ guide }: { guide: Extract<Guide, { kind: 'point' }> }) {
  return (
    <>
      <Html
        center
        position={[guide.point.x, guide.point.y + HUD_OFFSET, guide.point.z]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          style={{
            background: '#000',
            border: `2px solid ${COLOR_SHADOW}`,
            borderRadius: '50%',
            height: 10,
            width: 10,
          }}
        />
      </Html>
      <WorldLabel color="#374151" position={[guide.point.x, guide.point.y + HUD_OFFSET, guide.point.z]} text={guide.label} />
    </>
  )
}

function SnapMarker({ snap }: { snap: SnapResult }) {
  const isSquare = snap.type === 'edge' || snap.type === 'wall-face' || snap.type === 'guide-line'
  const isAxis = snap.axis !== undefined
  const isWallSnap =
    snap.type === 'endpoint' ||
    snap.type === 'midpoint' ||
    snap.type === 'edge' ||
    snap.type === 'measurement-endpoint'
  const markerY = isWallSnap ? snap.point.y + SNAP_MARKER_ELEVATION : snap.point.y + HUD_OFFSET
  const stemHeight = markerY - snap.point.y

  return (
    <>
      {isWallSnap && stemHeight > 0.05 ? (
        <mesh
          castShadow={false}
          position={[snap.point.x, snap.point.y + stemHeight / 2, snap.point.z]}
          receiveShadow={false}
        >
          <boxGeometry args={[SNAP_STEM_THICKNESS, stemHeight, SNAP_STEM_THICKNESS]} />
          <meshBasicMaterial color={snap.color} depthTest={false} opacity={0.7} transparent />
        </mesh>
      ) : null}
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
              border: `2px solid ${COLOR_SHADOW}`,
              borderRadius: isSquare || isAxis ? 2 : '50%',
              height: SNAP_MARKER_SIZE,
              width: SNAP_MARKER_SIZE,
              transform: 'translate(-50%, -50%)',
            }}
          />
          {snap.label ? (
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
          ) : null}
        </div>
      </Html>
    </>
  )
}

function EraserMarker({ hit }: { hit: GuideHit }) {
  return (
    <Html
      center
      position={[hit.point.x, hit.point.y + SNAP_MARKER_ELEVATION, hit.point.z]}
      style={{ pointerEvents: 'none', userSelect: 'none' }}
      zIndexRange={[220, 0]}
    >
      <div style={{ position: 'relative' }}>
        <div
          style={{
            alignItems: 'center',
            background: '#ef4444',
            border: `2px solid ${COLOR_SHADOW}`,
            borderRadius: '50%',
            color: '#fff',
            display: 'flex',
            fontFamily: 'monospace',
            fontSize: 12,
            fontWeight: 700,
            height: 22,
            justifyContent: 'center',
            transform: 'translate(-50%, -50%)',
            width: 22,
          }}
        >
          x
        </div>
        <div
          style={{
            position: 'absolute',
            left: 16,
            top: -9,
            background: '#1f2937',
            color: '#fff',
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: 10,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
          }}
        >
          Usuń {hit.label}
        </div>
      </div>
    </Html>
  )
}

function WorldLabel({
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
          textShadow: `-1.5px -1.5px 0 ${COLOR_SHADOW}, 1.5px -1.5px 0 ${COLOR_SHADOW}, -1.5px 1.5px 0 ${COLOR_SHADOW}, 1.5px 1.5px 0 ${COLOR_SHADOW}, 0 0 4px ${COLOR_SHADOW}`,
        }}
      >
        {text}
      </div>
    </Html>
  )
}
