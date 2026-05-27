import type { AnyNode, DoorNode, WallNode, WindowNode } from '@pascal-app/core'

export type WallReferenceSide = 'center' | 'front' | 'back' | 'top' | 'bottom' | 'start' | 'end'
export type WallReferencePointKind =
  | 'wall-corner'
  | 'wall-midpoint'
  | 'opening-corner'
  | 'opening-midpoint'

export type Vec3Tuple = [number, number, number]

export type WallReferencePoint = {
  id: string
  kind: WallReferencePointKind
  position: Vec3Tuple
}

export type WallReferenceEdge = {
  id: string
  kind: 'wall-edge' | 'opening-edge'
  from: Vec3Tuple
  to: Vec3Tuple
}

export type WallReferenceFace = {
  id: string
  side: WallReferenceSide
  center: Vec3Tuple
  size: Vec3Tuple
}

export type OpeningReference = {
  id: string
  nodeId: string
  kind: 'door' | 'window'
  left: number
  right: number
  bottom: number
  top: number
  points: WallReferencePoint[]
  edges: WallReferenceEdge[]
}

export type WallGeometryReferences = {
  wallId: WallNode['id']
  length: number
  thickness: number
  height: number
  points: WallReferencePoint[]
  edges: WallReferenceEdge[]
  faces: WallReferenceFace[]
  openings: OpeningReference[]
}

export type WallLevelGeometryReferences = Omit<
  WallGeometryReferences,
  'points' | 'edges' | 'faces' | 'openings'
> & {
  local: WallGeometryReferences
  points: WallReferencePoint[]
  edges: WallReferenceEdge[]
  faces: WallReferenceFace[]
  openings: OpeningReference[]
}

export type WallReferenceSnapKind = 'point' | 'edge' | 'face'

export type WallReferenceSnapResult = {
  wallId: WallNode['id']
  kind: WallReferenceSnapKind
  refId: string
  side?: WallReferenceSide
  position: Vec3Tuple
  localPosition: Vec3Tuple
  distance: number
}

export function wallReferenceSnapToCenterlinePoint(
  wall: WallNode,
  snap: Pick<WallReferenceSnapResult, 'localPosition'>,
): Vec3Tuple | null {
  return wallLocalToLevelPoint(wall, [snap.localPosition[0], 0, 0])
}

export type WallReferenceSnapOptions = {
  maxDistance?: number
  includeFaces?: boolean
  includeEdges?: boolean
  includePoints?: boolean
}

const DEFAULT_WALL_THICKNESS = 0.12
const DEFAULT_WALL_HEIGHT = 2.5
const EPSILON = 0.0001
const DEFAULT_SNAP_DISTANCE = 0.25

type WallOpeningNode = DoorNode | WindowNode

function isWallOpeningNode(node: AnyNode | undefined): node is WallOpeningNode {
  return node?.type === 'door' || node?.type === 'window'
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function wallLocalPoint(x: number, y: number, z: number): Vec3Tuple {
  return [x, y, z]
}

function makePoint(
  id: string,
  kind: WallReferencePointKind,
  position: Vec3Tuple,
): WallReferencePoint {
  return { id, kind, position }
}

function makeEdge(
  id: string,
  kind: WallReferenceEdge['kind'],
  from: Vec3Tuple,
  to: Vec3Tuple,
): WallReferenceEdge {
  return { id, kind, from, to }
}

function makeFace(
  id: string,
  side: WallReferenceSide,
  center: Vec3Tuple,
  size: Vec3Tuple,
): WallReferenceFace {
  return { id, side, center, size }
}

function getWallBasis(wall: WallNode) {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < EPSILON) return null

  const dirX = dx / length
  const dirZ = dz / length
  const perpX = -dirZ
  const perpZ = dirX

  return { dirX, dirZ, length, perpX, perpZ }
}

export function wallLocalToLevelPoint(wall: WallNode, point: Vec3Tuple): Vec3Tuple | null {
  const basis = getWallBasis(wall)
  if (!basis) return null

  const [localX, localY, localZ] = point
  return [
    wall.start[0] + basis.dirX * localX + basis.perpX * localZ,
    localY,
    wall.start[1] + basis.dirZ * localX + basis.perpZ * localZ,
  ]
}

export function wallLevelToLocalPoint(wall: WallNode, point: Vec3Tuple): Vec3Tuple | null {
  const basis = getWallBasis(wall)
  if (!basis) return null

  const dx = point[0] - wall.start[0]
  const dz = point[2] - wall.start[1]
  return [
    dx * basis.dirX + dz * basis.dirZ,
    point[1],
    dx * basis.perpX + dz * basis.perpZ,
  ]
}

function distance(a: Vec3Tuple, b: Vec3Tuple) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function closestPointOnSegment(point: Vec3Tuple, from: Vec3Tuple, to: Vec3Tuple): Vec3Tuple {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const lengthSq = dx * dx + dy * dy + dz * dz
  if (lengthSq < EPSILON) return from

  const t = clamp(
    ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy + (point[2] - from[2]) * dz) /
      lengthSq,
    0,
    1,
  )
  return [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t]
}

function closestPointOnFace(point: Vec3Tuple, face: WallReferenceFace): Vec3Tuple {
  const halfX = face.size[0] / 2
  const halfY = face.size[1] / 2
  const halfZ = face.size[2] / 2

  return [
    clamp(point[0], face.center[0] - halfX, face.center[0] + halfX),
    clamp(point[1], face.center[1] - halfY, face.center[1] + halfY),
    clamp(point[2], face.center[2] - halfZ, face.center[2] + halfZ),
  ]
}

function mapWallPointToLevel(wall: WallNode, point: WallReferencePoint): WallReferencePoint | null {
  const position = wallLocalToLevelPoint(wall, point.position)
  if (!position) return null
  return { ...point, position }
}

function mapWallEdgeToLevel(wall: WallNode, edge: WallReferenceEdge): WallReferenceEdge | null {
  const from = wallLocalToLevelPoint(wall, edge.from)
  const to = wallLocalToLevelPoint(wall, edge.to)
  if (!from || !to) return null
  return { ...edge, from, to }
}

function mapWallFaceToLevel(wall: WallNode, face: WallReferenceFace): WallReferenceFace | null {
  const center = wallLocalToLevelPoint(wall, face.center)
  if (!center) return null
  return { ...face, center }
}

function getOpeningBounds(
  opening: WallOpeningNode,
  wallLength: number,
  wallHeight: number,
): Pick<OpeningReference, 'left' | 'right' | 'bottom' | 'top'> {
  const width = opening.width
  const height = opening.height
  const centerX = opening.position[0]
  const centerY = opening.position[1]
  const halfWidth = width / 2
  const halfHeight = height / 2

  return {
    left: clamp(centerX - halfWidth, 0, wallLength),
    right: clamp(centerX + halfWidth, 0, wallLength),
    bottom: clamp(centerY - halfHeight, 0, wallHeight),
    top: clamp(centerY + halfHeight, 0, wallHeight),
  }
}

function getOpeningReferences(
  wall: WallNode,
  childNodes: AnyNode[],
  wallLength: number,
  wallHeight: number,
  halfThickness: number,
): OpeningReference[] {
  return childNodes.filter(isWallOpeningNode).map((opening) => {
    const { left, right, bottom, top } = getOpeningBounds(opening, wallLength, wallHeight)
    const z = opening.side === 'back' ? -halfThickness : halfThickness
    const prefix = `${wall.id}:opening:${opening.id}`

    const bottomLeft = wallLocalPoint(left, bottom, z)
    const bottomRight = wallLocalPoint(right, bottom, z)
    const topLeft = wallLocalPoint(left, top, z)
    const topRight = wallLocalPoint(right, top, z)
    const center = wallLocalPoint((left + right) / 2, (bottom + top) / 2, z)

    const points = [
      makePoint(`${prefix}:bottom-left`, 'opening-corner', bottomLeft),
      makePoint(`${prefix}:bottom-right`, 'opening-corner', bottomRight),
      makePoint(`${prefix}:top-left`, 'opening-corner', topLeft),
      makePoint(`${prefix}:top-right`, 'opening-corner', topRight),
      makePoint(`${prefix}:center`, 'opening-midpoint', center),
    ]

    const edges = [
      makeEdge(`${prefix}:left`, 'opening-edge', bottomLeft, topLeft),
      makeEdge(`${prefix}:right`, 'opening-edge', bottomRight, topRight),
      makeEdge(`${prefix}:bottom`, 'opening-edge', bottomLeft, bottomRight),
      makeEdge(`${prefix}:top`, 'opening-edge', topLeft, topRight),
    ]

    return {
      id: prefix,
      nodeId: opening.id,
      kind: opening.type,
      left,
      right,
      bottom,
      top,
      points,
      edges,
    }
  })
}

export function getWallGeometryReferences(
  wall: WallNode,
  nodes: Record<string, AnyNode | undefined>,
): WallGeometryReferences | null {
  const basis = getWallBasis(wall)
  if (!basis) return null
  const { length } = basis

  const thickness = wall.thickness ?? DEFAULT_WALL_THICKNESS
  const height = wall.height ?? DEFAULT_WALL_HEIGHT
  const halfThickness = thickness / 2
  const children = wall.children.map((childId) => nodes[childId]).filter(Boolean) as AnyNode[]
  const openings = getOpeningReferences(wall, children, length, height, halfThickness)

  const bottomFrontStart = wallLocalPoint(0, 0, halfThickness)
  const bottomFrontEnd = wallLocalPoint(length, 0, halfThickness)
  const topFrontStart = wallLocalPoint(0, height, halfThickness)
  const topFrontEnd = wallLocalPoint(length, height, halfThickness)
  const bottomBackStart = wallLocalPoint(0, 0, -halfThickness)
  const bottomBackEnd = wallLocalPoint(length, 0, -halfThickness)
  const topBackStart = wallLocalPoint(0, height, -halfThickness)
  const topBackEnd = wallLocalPoint(length, height, -halfThickness)

  const points = [
    makePoint(`${wall.id}:front:start:bottom`, 'wall-corner', bottomFrontStart),
    makePoint(`${wall.id}:front:end:bottom`, 'wall-corner', bottomFrontEnd),
    makePoint(`${wall.id}:front:start:top`, 'wall-corner', topFrontStart),
    makePoint(`${wall.id}:front:end:top`, 'wall-corner', topFrontEnd),
    makePoint(`${wall.id}:back:start:bottom`, 'wall-corner', bottomBackStart),
    makePoint(`${wall.id}:back:end:bottom`, 'wall-corner', bottomBackEnd),
    makePoint(`${wall.id}:back:start:top`, 'wall-corner', topBackStart),
    makePoint(`${wall.id}:back:end:top`, 'wall-corner', topBackEnd),
    makePoint(`${wall.id}:center:bottom`, 'wall-midpoint', wallLocalPoint(length / 2, 0, 0)),
    makePoint(`${wall.id}:center:top`, 'wall-midpoint', wallLocalPoint(length / 2, height, 0)),
  ]

  const edges = [
    makeEdge(`${wall.id}:front:bottom`, 'wall-edge', bottomFrontStart, bottomFrontEnd),
    makeEdge(`${wall.id}:front:top`, 'wall-edge', topFrontStart, topFrontEnd),
    makeEdge(`${wall.id}:front:start`, 'wall-edge', bottomFrontStart, topFrontStart),
    makeEdge(`${wall.id}:front:end`, 'wall-edge', bottomFrontEnd, topFrontEnd),
    makeEdge(`${wall.id}:back:bottom`, 'wall-edge', bottomBackStart, bottomBackEnd),
    makeEdge(`${wall.id}:back:top`, 'wall-edge', topBackStart, topBackEnd),
    makeEdge(`${wall.id}:back:start`, 'wall-edge', bottomBackStart, topBackStart),
    makeEdge(`${wall.id}:back:end`, 'wall-edge', bottomBackEnd, topBackEnd),
    makeEdge(`${wall.id}:top:front`, 'wall-edge', topFrontStart, topFrontEnd),
    makeEdge(`${wall.id}:top:back`, 'wall-edge', topBackStart, topBackEnd),
    makeEdge(`${wall.id}:start:cap-top`, 'wall-edge', topBackStart, topFrontStart),
    makeEdge(`${wall.id}:end:cap-top`, 'wall-edge', topBackEnd, topFrontEnd),
  ]

  const faces = [
    makeFace(`${wall.id}:face:center`, 'center', [length / 2, height / 2, 0], [
      length,
      height,
      0.003,
    ]),
    makeFace(`${wall.id}:face:front`, 'front', [length / 2, height / 2, halfThickness], [
      length,
      height,
      0.006,
    ]),
    makeFace(`${wall.id}:face:back`, 'back', [length / 2, height / 2, -halfThickness], [
      length,
      height,
      0.006,
    ]),
    makeFace(`${wall.id}:face:top`, 'top', [length / 2, height, 0], [length, 0.006, thickness]),
    makeFace(`${wall.id}:face:start`, 'start', [0, height / 2, 0], [0.006, height, thickness]),
    makeFace(`${wall.id}:face:end`, 'end', [length, height / 2, 0], [0.006, height, thickness]),
  ]

  return {
    wallId: wall.id,
    length,
    thickness,
    height,
    points: points.concat(openings.flatMap((opening) => opening.points)),
    edges: edges.concat(openings.flatMap((opening) => opening.edges)),
    faces,
    openings,
  }
}

export function getWallLevelGeometryReferences(
  wall: WallNode,
  nodes: Record<string, AnyNode | undefined>,
): WallLevelGeometryReferences | null {
  const local = getWallGeometryReferences(wall, nodes)
  if (!local) return null

  return {
    wallId: local.wallId,
    length: local.length,
    thickness: local.thickness,
    height: local.height,
    local,
    points: local.points
      .map((point) => mapWallPointToLevel(wall, point))
      .filter((point): point is WallReferencePoint => point !== null),
    edges: local.edges
      .map((edge) => mapWallEdgeToLevel(wall, edge))
      .filter((edge): edge is WallReferenceEdge => edge !== null),
    faces: local.faces
      .map((face) => mapWallFaceToLevel(wall, face))
      .filter((face): face is WallReferenceFace => face !== null),
    openings: local.openings.map((opening) => ({
      ...opening,
      points: opening.points
        .map((point) => mapWallPointToLevel(wall, point))
        .filter((point): point is WallReferencePoint => point !== null),
      edges: opening.edges
        .map((edge) => mapWallEdgeToLevel(wall, edge))
        .filter((edge): edge is WallReferenceEdge => edge !== null),
    })),
  }
}

export function findNearestWallReferenceSnap(
  levelPoint: Vec3Tuple,
  wall: WallNode,
  nodes: Record<string, AnyNode | undefined>,
  options: WallReferenceSnapOptions = {},
): WallReferenceSnapResult | null {
  const localPoint = wallLevelToLocalPoint(wall, levelPoint)
  const refs = getWallGeometryReferences(wall, nodes)
  if (!localPoint || !refs) return null

  const maxDistance = options.maxDistance ?? DEFAULT_SNAP_DISTANCE
  const includeFaces = options.includeFaces ?? true
  const includeEdges = options.includeEdges ?? true
  const includePoints = options.includePoints ?? true
  let best: WallReferenceSnapResult | null = null

  const updateBest = (
    kind: WallReferenceSnapKind,
    refId: string,
    localPosition: Vec3Tuple,
    side?: WallReferenceSide,
  ) => {
    const levelPosition = wallLocalToLevelPoint(wall, localPosition)
    if (!levelPosition) return

    const snapDistance = distance(localPoint, localPosition)
    if (snapDistance > maxDistance) return
    if (best && best.distance <= snapDistance + EPSILON) return

    best = {
      wallId: wall.id,
      kind,
      refId,
      side,
      position: levelPosition,
      localPosition,
      distance: snapDistance,
    }
  }

  if (includePoints) {
    for (const point of refs.points) {
      updateBest('point', point.id, point.position)
    }
  }

  if (includeEdges) {
    for (const edge of refs.edges) {
      updateBest('edge', edge.id, closestPointOnSegment(localPoint, edge.from, edge.to))
    }
  }

  if (includeFaces) {
    for (const face of refs.faces) {
      updateBest('face', face.id, closestPointOnFace(localPoint, face), face.side)
    }
  }

  return best
}

export function findNearestWallReferenceSnapAcrossWalls(
  levelPoint: Vec3Tuple,
  walls: WallNode[],
  nodes: Record<string, AnyNode | undefined>,
  options: WallReferenceSnapOptions = {},
): WallReferenceSnapResult | null {
  let best: WallReferenceSnapResult | null = null

  for (const wall of walls) {
    const snap = findNearestWallReferenceSnap(levelPoint, wall, nodes, options)
    if (!snap) continue
    if (!best || snap.distance < best.distance) {
      best = snap
    }
  }

  return best
}
