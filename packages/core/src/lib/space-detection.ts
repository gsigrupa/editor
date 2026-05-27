import {
  CeilingNode,
  type CeilingNode as CeilingNodeType,
  SlabNode,
  type SlabNode as SlabNodeType,
  type WallNode,
  ZoneNode,
  type ZoneNode as ZoneNodeType,
} from '../schema'
import {
  getSceneHistoryPauseDepth,
  pauseSceneHistory,
  resumeSceneHistory,
} from '../store/history-control'
import {
  getClampedWallCurveOffset,
  getWallCurveFrameAt,
  isCurvedWall,
} from '../systems/wall/wall-curve'
import { simplifyClosedPolygon } from './polygon-geometry'

type Point2D = { x: number; y: number }

export type Space = {
  id: string
  levelId: string
  polygon: Array<[number, number]>
  wallIds: string[]
  isExterior: boolean
}

type WallSideUpdate = {
  wallId: string
  frontSide: 'interior' | 'exterior' | 'unknown'
  backSide: 'interior' | 'exterior' | 'unknown'
}

type DetectedRoom = {
  poly: Point2D[]
  sig: string
  centroid: Point2D
  area: number
  bbox: ReturnType<typeof bboxOf>
}

export type AutoSlabSyncPlan = {
  create: SlabNodeType[]
  update: Array<{ id: SlabNodeType['id']; data: Partial<SlabNodeType> }>
  delete: Array<SlabNodeType['id']>
}

const DEFAULT_AUTO_SLAB_ELEVATION = 0.05
// GSI fork: 270 cm (typowo PL). Upstream Pascal mial 2.5. Spojnosc z
// DEFAULT_WALL_HEIGHT (core/systems/wall/wall-footprint.ts) i ceiling
// schema default (core/schema/nodes/ceiling.ts).
const DEFAULT_AUTO_CEILING_HEIGHT = 2.7
const ROOM_CURVE_TOLERANCE = 0.04
const MAX_CURVE_SUBDIVISION_DEPTH = 6
const AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE = 0.08

function pointFromTuple(point: [number, number]): Point2D {
  return { x: point[0], y: point[1] }
}

function pointToTuple(point: Point2D): [number, number] {
  return [point.x, point.y]
}

function pointKey(point: Point2D) {
  return `${point.x.toFixed(3)},${point.y.toFixed(3)}`
}

function polygonArea(points: Point2D[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!(a && b)) continue
    area += a.x * b.y - b.x * a.y
  }
  return area / 2
}

function minRotationSignature(keys: string[]) {
  if (keys.length === 0) return ''
  let best = ''
  for (let i = 0; i < keys.length; i++) {
    const rotated = [...keys.slice(i), ...keys.slice(0, i)]
    const value = rotated.join('|')
    if (!best || value < best) best = value
  }
  return best
}

function polygonSignature(points: Point2D[]) {
  const keys = points.map(pointKey)
  const forward = minRotationSignature(keys)
  const reversed = minRotationSignature([...keys].reverse())
  return forward < reversed ? forward : reversed
}

function samePointWithinTolerance(a: Point2D, b: Point2D, tolerance = 1e-4) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance
}

function dedupeSequentialPoints(points: Point2D[], tolerance = 1e-4) {
  const deduped: Point2D[] = []

  for (const point of points) {
    const previous = deduped[deduped.length - 1]
    if (previous && samePointWithinTolerance(previous, point, tolerance)) {
      continue
    }
    deduped.push(point)
  }

  const firstPoint = deduped[0]
  const lastPoint = deduped[deduped.length - 1]
  if (
    deduped.length > 2 &&
    firstPoint &&
    lastPoint &&
    samePointWithinTolerance(firstPoint, lastPoint, tolerance)
  ) {
    deduped.pop()
  }

  return deduped
}

function pointInPolygon(point: Point2D, polygon: Point2D[]) {
  if (polygon.length < 3) return false

  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]?.x ?? 0
    const yi = polygon[i]?.y ?? 0
    const xj = polygon[j]?.x ?? 0
    const yj = polygon[j]?.y ?? 0

    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }

  return inside
}

function pointInAnyPolygon(point: Point2D, polygons: Point2D[][]) {
  return polygons.some((polygon) => pointInPolygon(point, polygon))
}

function polygonCentroid(points: Point2D[]) {
  const sum = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), {
    x: 0,
    y: 0,
  })

  return {
    x: sum.x / Math.max(points.length, 1),
    y: sum.y / Math.max(points.length, 1),
  }
}

function bboxOf(points: Point2D[]) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return { minX, minY, maxX, maxY }
}

function bboxOverlapArea(a: ReturnType<typeof bboxOf>, b: ReturnType<typeof bboxOf>) {
  const ix = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const iy = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
  return ix * iy
}

function getWallDirection(wall: Pick<WallNode, 'start' | 'end'>) {
  const dx = wall.end[0] - wall.start[0]
  const dy = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dy)

  if (length < 1e-9) {
    return {
      point: pointFromTuple(wall.start),
      tangent: { x: 1, y: 0 },
      normal: { x: 0, y: 1 },
    }
  }

  const tangent = { x: dx / length, y: dy / length }
  return {
    point: {
      x: (wall.start[0] + wall.end[0]) / 2,
      y: (wall.start[1] + wall.end[1]) / 2,
    },
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
  }
}

function pointLineDistance(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared < 1e-9) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx
  return Math.abs(cross) / Math.sqrt(lengthSquared)
}

function sampleWallPointsForRoomDetection(
  wall: Pick<WallNode, 'start' | 'end' | 'curveOffset'>,
  tolerance = ROOM_CURVE_TOLERANCE,
) {
  const start = { x: wall.start[0], y: wall.start[1] }
  const end = { x: wall.end[0], y: wall.end[1] }

  if (!isCurvedWall(wall)) {
    return [start, end]
  }

  const subdivide = (
    t0: number,
    p0: Point2D,
    t1: number,
    p1: Point2D,
    depth: number,
  ): Point2D[] => {
    const midT = (t0 + t1) / 2
    const midPoint = getWallCurveFrameAt(wall, midT).point
    const deviation = pointLineDistance(midPoint, p0, p1)

    if (depth >= MAX_CURVE_SUBDIVISION_DEPTH || deviation <= tolerance) {
      return [p0, p1]
    }

    const left = subdivide(t0, p0, midT, midPoint, depth + 1)
    const right = subdivide(midT, midPoint, t1, p1, depth + 1)
    return [...left.slice(0, -1), ...right]
  }

  return subdivide(0, start, 1, end, 0)
}

function getDirectedWallBoundaryPoints(wall: WallNode, forward: boolean) {
  const points = sampleWallPointsForRoomDetection(wall)
  return forward ? points : [...points].reverse()
}

function extractRoomPolygons(walls: WallNode[]): Point2D[][] {
  if (walls.length < 3) return []

  type HalfEdge = {
    id: string
    reverseId: string
    fromKey: string
    toKey: string
    angle: number
    points: Point2D[]
  }
  type Node = { point: Point2D; outgoing: string[] }

  const graph = new Map<string, Node>()
  const halfEdges = new Map<string, HalfEdge>()

  const upsertNode = (point: Point2D) => {
    const key = pointKey(point)
    if (!graph.has(key)) {
      graph.set(key, { point: { ...point }, outgoing: [] })
    }
    return key
  }

  for (const wall of walls) {
    const start = pointFromTuple(wall.start)
    const end = pointFromTuple(wall.end)
    const startKey = upsertNode(start)
    const endKey = upsertNode(end)
    if (startKey === endKey) continue

    const forwardDirection = getWallDirection(wall)
    const reverseDirection = getWallDirection({ start: wall.end, end: wall.start })

    const forwardId = `${wall.id}:f`
    const reverseId = `${wall.id}:r`

    halfEdges.set(forwardId, {
      id: forwardId,
      reverseId,
      fromKey: startKey,
      toKey: endKey,
      angle: Math.atan2(forwardDirection.tangent.y, forwardDirection.tangent.x),
      points: getDirectedWallBoundaryPoints(wall, true),
    })
    halfEdges.set(reverseId, {
      id: reverseId,
      reverseId: forwardId,
      fromKey: endKey,
      toKey: startKey,
      angle: Math.atan2(reverseDirection.tangent.y, reverseDirection.tangent.x),
      points: getDirectedWallBoundaryPoints(wall, false),
    })

    graph.get(startKey)?.outgoing.push(forwardId)
    graph.get(endKey)?.outgoing.push(reverseId)
  }

  const sortedOutgoing = new Map<string, string[]>()
  for (const [key, node] of graph.entries()) {
    const outgoing = [...node.outgoing]
    outgoing.sort((a, b) => (halfEdges.get(a)?.angle ?? 0) - (halfEdges.get(b)?.angle ?? 0))
    sortedOutgoing.set(key, outgoing)
  }

  const nextEdge = (edgeId: string) => {
    const edge = halfEdges.get(edgeId)
    if (!edge) return null

    const outgoing = sortedOutgoing.get(edge.toKey)
    if (!outgoing || outgoing.length === 0) return null

    const idx = outgoing.indexOf(edge.reverseId)
    if (idx === -1) return null

    const nextIdx = (idx - 1 + outgoing.length) % outgoing.length
    return outgoing[nextIdx] ?? null
  }

  const visitedDirected = new Set<string>()
  const faces: Point2D[][] = []
  const maxSteps = Math.min(500, walls.length * 8 + 20)

  for (const edgeId of halfEdges.keys()) {
    if (visitedDirected.has(edgeId)) continue

    const cycleEdgeIds: string[] = []
    let currentEdgeId = edgeId
    let valid = true

    for (let step = 0; step < maxSteps; step += 1) {
      const currentEdge = halfEdges.get(currentEdgeId)
      if (!currentEdge) {
        valid = false
        break
      }

      visitedDirected.add(currentEdgeId)
      cycleEdgeIds.push(currentEdgeId)

      const next = nextEdge(currentEdgeId)
      if (!next) {
        valid = false
        break
      }

      currentEdgeId = next
      if (currentEdgeId === edgeId) break
    }

    if (!valid || cycleEdgeIds.length < 3) continue

    const polygon = dedupeSequentialPoints(
      cycleEdgeIds.flatMap((id, index) => {
        const points = halfEdges.get(id)?.points ?? []
        return index === cycleEdgeIds.length - 1 ? points : points.slice(0, -1)
      }),
    )

    if (polygon.length < 3) continue

    const signedArea = polygonArea(polygon)
    if (signedArea <= 0) continue
    if (signedArea < 0.5 || signedArea > 10_000) continue

    const signature = polygonSignature(polygon)
    if (faces.some((face) => polygonSignature(face) === signature)) continue

    faces.push(polygon)
  }

  faces.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))
  return faces
}

export function resolveWallSurfaceSides(
  wall: Pick<WallNode, 'start' | 'end' | 'thickness' | 'frontSide' | 'backSide'>,
  roomPolygons: Point2D[][],
): Pick<WallSideUpdate, 'frontSide' | 'backSide'> {
  if (roomPolygons.length === 0) {
    return {
      frontSide: 'unknown' as const,
      backSide: 'unknown' as const,
    }
  }

  const frame = getWallDirection(wall)
  const normalLength = Math.hypot(frame.normal.x, frame.normal.y)
  if (normalLength < 1e-9) {
    return {
      frontSide: wall.frontSide,
      backSide: wall.backSide,
    }
  }

  const normalX = frame.normal.x / normalLength
  const normalY = frame.normal.y / normalLength
  const sampleDistance = Math.max((wall.thickness ?? 0.2) / 2 + 0.08, 0.16)

  const frontPoint = {
    x: frame.point.x + normalX * sampleDistance,
    y: frame.point.y + normalY * sampleDistance,
  }
  const backPoint = {
    x: frame.point.x - normalX * sampleDistance,
    y: frame.point.y - normalY * sampleDistance,
  }

  const frontInside = pointInAnyPolygon(frontPoint, roomPolygons)
  const backInside = pointInAnyPolygon(backPoint, roomPolygons)

  if (frontInside === backInside) {
    return {
      frontSide: wall.frontSide,
      backSide: wall.backSide,
    }
  }

  return {
    frontSide: frontInside ? 'interior' : 'exterior',
    backSide: backInside ? 'interior' : 'exterior',
  }
}

// GSI fork: auto-naming po PL ("Pomieszczenie N Podłoga/Sufit"). Regex
// match backward-compat dla starych scen z EN names ("Room N Slab/Ceiling")
// — żeby kontynuować nowy index gdy user otwiera scenę sprzed forka.
function nextAutoRoomName(
  nodes: Array<{
    name?: string
  }>,
  suffix: 'Podłoga' | 'Sufit',
) {
  let maxIndex = 0

  for (const node of nodes) {
    const match =
      /^(?:Room|Pomieszczenie)\s+(\d+)(?:\s+(?:Slab|Ceiling|Podłoga|Sufit))?$/i.exec(
        (node.name ?? '').trim(),
      )
    if (!match) continue
    const index = Number(match[1])
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index)
    }
  }

  return `Pomieszczenie ${maxIndex + 1} ${suffix}`
}

function sameTuplePolygon(current: Array<[number, number]>, next: Array<[number, number]>) {
  return (
    current.length === next.length &&
    current.every((point, index) => point[0] === next[index]?.[0] && point[1] === next[index]?.[1])
  )
}

function wallGeometrySignature(wall: WallNode) {
  return [
    wall.id,
    wall.start[0].toFixed(4),
    wall.start[1].toFixed(4),
    wall.end[0].toFixed(4),
    wall.end[1].toFixed(4),
    (wall.thickness ?? 0.2).toFixed(4),
    getClampedWallCurveOffset(wall).toFixed(4),
  ].join('|')
}

function levelWallSnapshot(walls: WallNode[]) {
  return walls.map(wallGeometrySignature).sort().join('||')
}

function buildSpace(levelId: string, polygon: Point2D[]): Space {
  const signature = polygonSignature(polygon)
  return {
    id: `space-${levelId}-${signature.slice(0, 12)}`,
    levelId,
    polygon: polygon.map(pointToTuple),
    wallIds: [],
    isExterior: false,
  }
}

export function planAutoSlabsForLevel(
  roomPolygons: Point2D[][],
  existingSlabs: SlabNodeType[],
): AutoSlabSyncPlan {
  const manualSlabs = existingSlabs.filter((slab) => !slab.autoFromWalls)
  const manualSignatures = new Set(
    manualSlabs.map((slab) => polygonSignature(slab.polygon.map(pointFromTuple))),
  )

  const detected: DetectedRoom[] = roomPolygons
    .map((poly) => ({
      poly: simplifyClosedPolygon(poly.map(pointToTuple), AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE).map(
        pointFromTuple,
      ),
      sig: '',
      centroid: { x: 0, y: 0 },
      area: 0,
      bbox: bboxOf([]),
    }))
    .map((room) => ({
      ...room,
      sig: polygonSignature(room.poly),
      centroid: polygonCentroid(room.poly),
      area: Math.abs(polygonArea(room.poly)),
      bbox: bboxOf(room.poly),
    }))
    .filter(({ sig }) => !manualSignatures.has(sig))

  const existingAuto = existingSlabs.filter((slab) => slab.autoFromWalls)
  const existingAutoMeta = existingAuto.map((slab) => {
    const poly = slab.polygon.map(pointFromTuple)
    return {
      slab,
      sig: polygonSignature(poly),
      centroid: polygonCentroid(poly),
      area: Math.abs(polygonArea(poly)),
      bbox: bboxOf(poly),
    }
  })

  const matchedSlabIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()
  const updatesById = new Map<string, [number, number][]>()

  const autoBySignature = new Map<string, (typeof existingAutoMeta)[number]>()
  for (const entry of existingAutoMeta) {
    autoBySignature.set(entry.sig, entry)
  }

  detected.forEach((room, index) => {
    const existing = autoBySignature.get(room.sig)
    if (!existing) return

    matchedDetectedIdx.add(index)
    matchedSlabIds.add(existing.slab.id)
    updatesById.set(existing.slab.id, room.poly.map(pointToTuple))
  })

  const remainingDetected = detected
    .map((room, index) => ({ room, index }))
    .filter(({ index }) => !matchedDetectedIdx.has(index))
    .sort((a, b) => b.room.area - a.room.area)

  const remainingAuto = existingAutoMeta.filter((entry) => !matchedSlabIds.has(entry.slab.id))

  for (const { room, index } of remainingDetected) {
    let bestMatch: { entry: (typeof remainingAuto)[number]; score: number } | null = null

    for (const entry of remainingAuto) {
      if (matchedSlabIds.has(entry.slab.id)) continue

      const dx = room.centroid.x - entry.centroid.x
      const dy = room.centroid.y - entry.centroid.y
      const dist = Math.hypot(dx, dy)
      const areaRatio = entry.area > 1e-6 ? room.area / entry.area : 999
      const areaPenalty = Math.abs(Math.log(Math.max(1e-6, areaRatio)))
      const overlap = bboxOverlapArea(room.bbox, entry.bbox)

      if (overlap <= 0.0001 && dist > 1.5) continue

      const score = dist + areaPenalty * 0.35
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { entry, score }
      }
    }

    if (!bestMatch) continue

    matchedDetectedIdx.add(index)
    matchedSlabIds.add(bestMatch.entry.slab.id)
    updatesById.set(bestMatch.entry.slab.id, room.poly.map(pointToTuple))
  }

  const slabsToDelete = existingAuto
    .filter((slab) => !updatesById.has(slab.id))
    .map((slab) => slab.id)

  const slabsToUpdate = existingAuto
    .filter((slab) => updatesById.has(slab.id))
    .flatMap((slab) => {
      const polygon = updatesById.get(slab.id)
      if (!polygon) return []

      return sameTuplePolygon(slab.polygon, polygon) ? [] : [{ id: slab.id, data: { polygon } }]
    })

  const plannedSlabsForNaming: Array<{ name?: string }> = [...existingSlabs]
  const slabsToCreate: SlabNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedSlabsForNaming, 'Podłoga')
    plannedSlabsForNaming.push({ name })

    slabsToCreate.push(
      SlabNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        holes: [],
        elevation: DEFAULT_AUTO_SLAB_ELEVATION,
        autoFromWalls: true,
      }),
    )
  }

  return {
    create: slabsToCreate,
    update: slabsToUpdate,
    delete: slabsToDelete,
  }
}

function syncAutoSlabsForLevel(
  levelId: string,
  roomPolygons: Point2D[][],
  existingSlabs: SlabNodeType[],
  sceneStore: any,
) {
  const plan = planAutoSlabsForLevel(roomPolygons, existingSlabs)

  if (plan.delete.length > 0) {
    sceneStore.getState().deleteNodes(plan.delete)
  }

  if (plan.update.length > 0) {
    sceneStore.getState().updateNodes(plan.update)
  }

  if (plan.create.length > 0) {
    sceneStore.getState().createNodes(plan.create.map((node) => ({ node, parentId: levelId })))
  }
}

function syncAutoCeilingsForLevel(
  levelId: string,
  roomPolygons: Point2D[][],
  existingCeilings: CeilingNodeType[],
  sceneStore: any,
) {
  const manualCeilings = existingCeilings.filter((ceiling) => !ceiling.autoFromWalls)
  const manualSignatures = new Set(
    manualCeilings.map((ceiling) => polygonSignature(ceiling.polygon.map(pointFromTuple))),
  )

  const detected: DetectedRoom[] = roomPolygons
    .map((poly) => ({
      poly: simplifyClosedPolygon(poly.map(pointToTuple), AUTO_SLAB_POLYGON_SIMPLIFY_TOLERANCE).map(
        pointFromTuple,
      ),
      sig: '',
      centroid: { x: 0, y: 0 },
      area: 0,
      bbox: bboxOf([]),
    }))
    .map((room) => ({
      ...room,
      sig: polygonSignature(room.poly),
      centroid: polygonCentroid(room.poly),
      area: Math.abs(polygonArea(room.poly)),
      bbox: bboxOf(room.poly),
    }))
    .filter(({ sig }) => !manualSignatures.has(sig))

  const existingAuto = existingCeilings.filter((ceiling) => ceiling.autoFromWalls)
  const existingAutoMeta = existingAuto.map((ceiling) => {
    const poly = ceiling.polygon.map(pointFromTuple)
    return {
      ceiling,
      sig: polygonSignature(poly),
      centroid: polygonCentroid(poly),
      area: Math.abs(polygonArea(poly)),
      bbox: bboxOf(poly),
    }
  })

  const matchedCeilingIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()
  const updatesById = new Map<string, [number, number][]>()

  const autoBySignature = new Map<string, (typeof existingAutoMeta)[number]>()
  for (const entry of existingAutoMeta) {
    autoBySignature.set(entry.sig, entry)
  }

  detected.forEach((room, index) => {
    const existing = autoBySignature.get(room.sig)
    if (!existing) return

    matchedDetectedIdx.add(index)
    matchedCeilingIds.add(existing.ceiling.id)
    updatesById.set(existing.ceiling.id, room.poly.map(pointToTuple))
  })

  const remainingDetected = detected
    .map((room, index) => ({ room, index }))
    .filter(({ index }) => !matchedDetectedIdx.has(index))
    .sort((a, b) => b.room.area - a.room.area)

  const remainingAuto = existingAutoMeta.filter((entry) => !matchedCeilingIds.has(entry.ceiling.id))

  for (const { room, index } of remainingDetected) {
    let bestMatch: { entry: (typeof remainingAuto)[number]; score: number } | null = null

    for (const entry of remainingAuto) {
      if (matchedCeilingIds.has(entry.ceiling.id)) continue

      const dx = room.centroid.x - entry.centroid.x
      const dy = room.centroid.y - entry.centroid.y
      const dist = Math.hypot(dx, dy)
      const areaRatio = entry.area > 1e-6 ? room.area / entry.area : 999
      const areaPenalty = Math.abs(Math.log(Math.max(1e-6, areaRatio)))
      const overlap = bboxOverlapArea(room.bbox, entry.bbox)

      if (overlap <= 0.0001 && dist > 1.5) continue

      const score = dist + areaPenalty * 0.35
      if (!bestMatch || score < bestMatch.score) {
        bestMatch = { entry, score }
      }
    }

    if (!bestMatch) continue

    matchedDetectedIdx.add(index)
    matchedCeilingIds.add(bestMatch.entry.ceiling.id)
    updatesById.set(bestMatch.entry.ceiling.id, room.poly.map(pointToTuple))
  }

  const ceilingsToDelete = existingAuto
    .filter((ceiling) => !updatesById.has(ceiling.id))
    .map((ceiling) => ceiling.id)

  const ceilingsToUpdate = existingAuto
    .filter((ceiling) => updatesById.has(ceiling.id))
    .flatMap((ceiling) => {
      const polygon = updatesById.get(ceiling.id)
      if (!polygon) return []

      return sameTuplePolygon(ceiling.polygon, polygon)
        ? []
        : [{ id: ceiling.id, data: { polygon } }]
    })

  const plannedCeilingsForNaming: Array<{ name?: string }> = [...existingCeilings]
  const ceilingsToCreate: CeilingNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index)) continue

    const room = detected[index]
    if (!room) continue

    const name = nextAutoRoomName(plannedCeilingsForNaming, 'Sufit')
    plannedCeilingsForNaming.push({ name })

    ceilingsToCreate.push(
      CeilingNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        holes: [],
        height: DEFAULT_AUTO_CEILING_HEIGHT,
        autoFromWalls: true,
      }),
    )
  }

  if (ceilingsToDelete.length > 0) {
    sceneStore.getState().deleteNodes(ceilingsToDelete)
  }

  if (ceilingsToUpdate.length > 0) {
    sceneStore.getState().updateNodes(ceilingsToUpdate)
  }

  if (ceilingsToCreate.length > 0) {
    sceneStore.getState().createNodes(ceilingsToCreate.map((node) => ({ node, parentId: levelId })))
  }
}

// GSI fork: nextAutoZoneName — naming dla auto-zone bez suffix (zone reprezentuje
// całe pomieszczenie jako entity, nie konkretny element jak slab/ceiling).
// Regex match backward-compat ze starymi "Room N" + slab/ceiling suffix.
function nextAutoZoneName(nodes: Array<{ name?: string }>) {
  let maxIndex = 0
  for (const node of nodes) {
    const match = /^(?:Room|Pomieszczenie)\s+(\d+)/i.exec((node.name ?? '').trim())
    if (!match) continue
    const index = Number(match[1])
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index)
    }
  }
  return `Pomieszczenie ${maxIndex + 1}`
}

function isDefaultAutoZoneName(name?: string): boolean {
  return /^Pomieszczenie\s+\d+$/i.test((name ?? '').trim())
}

// GSI fork: helpers do polygon overlap detection (preserve zone name
// na zdarzeniu "split" — gdy user dorzuca wall'e wewnątrz zone, dzieli
// na podpokoje). Naming z prefiksem `tuple` żeby uniknąć kolizji z
// istniejącymi `polygonArea`/`polygonCentroid` (operują na Point2D z
// { x, y }, my potrzebujemy tuple [x, y]).
function tuplePolygonAreaSigned(poly: Array<[number, number]>): number {
  let sum = 0
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (!(a && b)) continue
    sum += (a[0] ?? 0) * (b[1] ?? 0) - (b[0] ?? 0) * (a[1] ?? 0)
  }
  return sum / 2
}
function tuplePolygonArea(poly: Array<[number, number]>): number {
  return Math.abs(tuplePolygonAreaSigned(poly))
}
function tuplePolygonCentroid(poly: Array<[number, number]>): [number, number] {
  let cx = 0
  let cy = 0
  for (const [x, y] of poly) {
    cx += x
    cy += y
  }
  return [cx / poly.length, cy / poly.length]
}
function pointInTuplePolygon(point: [number, number], poly: Array<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]
    const b = poly[j]
    if (!(a && b)) continue
    const intersect =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1] + 1e-12) + a[0]
    if (intersect) inside = !inside
  }
  return inside
}

// GSI fork: planAutoZonesForLevel — analog do planAutoSlabsForLevel.
// Tworzy/aktualizuje/usuwa zones z autoFromWalls=true na podstawie
// wykrytych pokoi. Ręcznie utworzone zones (autoFromWalls=false)
// nie są ruszane.
//
// 2026-05-24: split inheritance — gdy zone "Hall" rozpada się na 2+
// nowe pokoje (user dorzucił wall wewnątrz), zachowuje swoją nazwę
// dla pierwszego (największego) nowego pokoju zawartego w jej polygonie,
// reszta dostaje "{name} 2", "{name} 3"... Bez tego user gubił nazwę
// "Hall" przy każdym podziale pomieszczenia.
//
// Match polygonów rotation-invariant (jak cascade rename) — patrz
// samePolygonAnyRotation niżej w pliku.
export function planAutoZonesForLevel(
  roomPolygons: Point2D[][],
  existingZones: ZoneNodeType[],
) {
  const existingAuto = existingZones.filter((zone) => zone.autoFromWalls === true)

  const detected = roomPolygons.map((polygon) => ({
    poly: polygon,
    tuple: polygon.map(pointToTuple),
  }))

  const matchedExistingIds = new Set<string>()
  const matchedDetectedIdx = new Set<number>()

  // Pass 1: exact (rotation-invariant) polygon match — zone niezmieniony.
  for (const zone of existingAuto) {
    for (let i = 0; i < detected.length; i += 1) {
      if (matchedDetectedIdx.has(i)) continue
      const room = detected[i]
      if (!room) continue
      if (samePolygonAnyRotation(zone.polygon as Array<[number, number]>, room.tuple)) {
        matchedExistingIds.add(zone.id)
        matchedDetectedIdx.add(i)
        break
      }
    }
  }

  // Pass 2: SPLIT inheritance — pozostałe (unmatched) existingAuto może
  // być zone'em który podzielił się na nowe pokoje. Szukamy detected
  // pokoi z centroid wewnątrz starego zone polygon — przepisujemy nazwę
  // największemu. Dla custom nazw ("Salon") kolejne pokoje dostają
  // "Salon 2", "Salon 3"; dla domyślnych "Pomieszczenie N" używamy
  // kolejnego wolnego numeru, żeby zone/sufit/podłoga miały spójny naming.
  const splitInherited = new Map<
    number,
    { baseName: string; inheritedName?: string; order: number }
  >()
  for (const zone of existingAuto) {
    if (matchedExistingIds.has(zone.id)) continue
    const zonePoly = zone.polygon as Array<[number, number]>
    const childIndices: Array<{ idx: number; area: number }> = []
    for (let i = 0; i < detected.length; i += 1) {
      if (matchedDetectedIdx.has(i)) continue
      if (splitInherited.has(i)) continue
      const room = detected[i]
      if (!room) continue
      const centroid = tuplePolygonCentroid(room.tuple)
      if (pointInTuplePolygon(centroid, zonePoly)) {
        childIndices.push({ idx: i, area: tuplePolygonArea(room.tuple) })
      }
    }
    if (childIndices.length === 0) continue
    // Sort by area desc — największy nowy pokój dostaje oryginalną nazwę.
    childIndices.sort((a, b) => b.area - a.area)
    const baseName = zone.name ?? nextAutoZoneName([])
    childIndices.forEach((child, order) => {
      const inheritedName =
        order === 0
          ? baseName
          : isDefaultAutoZoneName(baseName)
            ? undefined
            : `${baseName} ${order + 1}`

      splitInherited.set(child.idx, {
        baseName,
        inheritedName,
        order,
      })
      matchedDetectedIdx.add(child.idx)
    })
    matchedExistingIds.add(zone.id) // mark as "consumed" — usunie się ale przepisaliśmy nazwę
  }

  const zonesToDelete = existingAuto
    .filter((zone) => !matchedExistingIds.has(zone.id))
    .map((zone) => zone.id)

  // Plus stare zone'y przepisane do split inherited też trzeba usunąć
  // (już mają matchedExistingIds.has true, więc nie znajdą się wyżej).
  for (const zone of existingAuto) {
    const wasInheritedConsumed = Array.from(splitInherited.values()).some((entry) =>
      entry.baseName === zone.name,
    )
    if (wasInheritedConsumed && !zonesToDelete.includes(zone.id)) {
      zonesToDelete.push(zone.id)
    }
  }

  // Zones to update — pominięte (delete+create approach).
  const zonesToUpdate: Array<{ id: string; data: { polygon: Array<[number, number]> } }> = []

  const plannedZonesForNaming: Array<{ name?: string }> = [...existingZones]
  const zonesToCreate: ZoneNodeType[] = []
  for (let index = 0; index < detected.length; index += 1) {
    if (matchedDetectedIdx.has(index) && !splitInherited.has(index)) continue
    const room = detected[index]
    if (!room) continue

    const inherited = splitInherited.get(index)
    const name = inherited?.inheritedName ?? nextAutoZoneName(plannedZonesForNaming)
    plannedZonesForNaming.push({ name })

    zonesToCreate.push(
      ZoneNode.parse({
        name,
        polygon: room.poly.map(pointToTuple),
        color: '#3b82f6',
        autoFromWalls: true,
      }),
    )
  }

  return {
    create: zonesToCreate,
    update: zonesToUpdate,
    delete: zonesToDelete,
  }
}

function syncAutoZonesForLevel(
  levelId: string,
  roomPolygons: Point2D[][],
  existingZones: ZoneNodeType[],
  sceneStore: any,
) {
  const plan = planAutoZonesForLevel(roomPolygons, existingZones)

  if (plan.delete.length > 0) {
    sceneStore.getState().deleteNodes(plan.delete)
  }
  if (plan.update.length > 0) {
    sceneStore.getState().updateNodes(plan.update)
  }
  if (plan.create.length > 0) {
    sceneStore.getState().createNodes(plan.create.map((node) => ({ node, parentId: levelId })))
  }
}

function detectSpacesFromWalls(levelId: string, walls: WallNode[]) {
  const roomPolygons = extractRoomPolygons(walls)
  const wallUpdates: WallSideUpdate[] = walls.map((wall) => ({
    wallId: wall.id,
    ...(resolveWallSurfaceSides(wall, roomPolygons) satisfies Pick<
      WallSideUpdate,
      'frontSide' | 'backSide'
    >),
  }))

  return {
    roomPolygons,
    spaces: roomPolygons.map((polygon) => buildSpace(levelId, polygon)),
    wallUpdates,
  }
}

export function detectSpacesForLevel(levelId: string, walls: WallNode[]) {
  return detectSpacesFromWalls(levelId, walls)
}

function runSpaceDetection(
  levelIds: string[],
  sceneStore: any,
  editorStore: any,
  nodes: any,
): void {
  const { updateNodes } = sceneStore.getState()
  const existingSpaces = editorStore.getState().spaces as Record<string, Space>
  const nextSpaces: Record<string, Space> = {}

  for (const [spaceId, space] of Object.entries(existingSpaces)) {
    if (!levelIds.includes(space.levelId)) {
      nextSpaces[spaceId] = space
    }
  }

  for (const levelId of levelIds) {
    const walls = Object.values(nodes).filter(
      (node: any): node is WallNode => node?.type === 'wall' && node.parentId === levelId,
    )

    const slabs = Object.values(nodes).filter(
      (node: any) => node?.type === 'slab' && node.parentId === levelId,
    )
    const ceilings = Object.values(nodes).filter(
      (node: any) => node?.type === 'ceiling' && node.parentId === levelId,
    )
    // GSI fork: auto-zones synchronizowane z detected pokojami (analog slab/ceiling).
    const zones = Object.values(nodes).filter(
      (node: any) => node?.type === 'zone' && node.parentId === levelId,
    )

    const { wallUpdates, spaces, roomPolygons } = detectSpacesFromWalls(levelId, walls)

    const changedWallUpdates = wallUpdates.filter((update) => {
      const wall = nodes[update.wallId]
      return wall && (wall.frontSide !== update.frontSide || wall.backSide !== update.backSide)
    })

    if (changedWallUpdates.length > 0) {
      updateNodes(
        changedWallUpdates.map((update) => ({
          id: update.wallId,
          data: {
            frontSide: update.frontSide,
            backSide: update.backSide,
          },
        })),
      )
    }

    syncAutoSlabsForLevel(
      levelId,
      roomPolygons,
      slabs.map((slab: any) => SlabNode.parse(slab)),
      sceneStore,
    )
    syncAutoCeilingsForLevel(
      levelId,
      roomPolygons,
      ceilings.map((ceiling: any) => CeilingNode.parse(ceiling)),
      sceneStore,
    )
    // GSI fork: zone z polygon = pokój. Daje user'owi możliwość rename
    // pomieszczenia (zone ma name field) bez ręcznego rysowania w trybie
    // strefy (który snap'uje do grida i nie matchuje wymiarów ścian).
    syncAutoZonesForLevel(
      levelId,
      roomPolygons,
      zones.map((zone: any) => ZoneNode.parse(zone)),
      sceneStore,
    )

    for (const space of spaces) {
      nextSpaces[space.id] = space
    }
  }

  editorStore.getState().setSpaces(nextSpaces)
}

// GSI fork: regex name patternu auto-slab/ceiling — używane do detekcji
// czy nazwa jest "domyślna" (czy można ją bezpiecznie nadpisać przy
// kaskadzie rename zone). Pasuje do:
//   - "Pomieszczenie N Podłoga/Sufit" (current convention)
//   - "Room N Slab/Ceiling" (legacy upstream)
//   - "<dowolna nazwa> Podłoga/Sufit" (po wcześniejszym rename zone)
const AUTO_ROOM_NAME_PATTERN = /^(?:.+?)\s+(Podłoga|Sufit|Slab|Ceiling)$/i

// GSI fork: cascade — gdy user zmieni nazwę auto-zone (np. "Pomieszczenie 1"
// → "Kuchnia"), znajdź auto-slab + auto-ceiling z polygon match i zaktualizuj
// ich nazwy na "<nowa nazwa> Podłoga" i "<nowa nazwa> Sufit". User-rename'd
// slab/ceiling (name nie matchuje AUTO_ROOM_NAME_PATTERN) nie są ruszane.
/**
 * GSI fork: rotation-invariant polygon match. sameTuplePolygon jest
 * strict-order (porównuje element-by-element), ale slab/ceiling i zone
 * w jednej scenie często mają ten sam polygon zaczynający się od innego
 * vertex'a (detection rotuje punkty w zależności od kierunku detekcji
 * pętli ścian). Cascade rename musi je matchować mimo rotacji.
 *
 * Implementacja: próbuje wszystkie N rotacji + odwrotny order (reverse
 * winding) — dla typowych pokoi z 4-12 wierzchołkami koszt < 1 ms.
 */
function samePolygonAnyRotation(
  a: Array<[number, number]>,
  b: Array<[number, number]>,
): boolean {
  if (a.length !== b.length) return false
  const n = a.length
  if (n === 0) return true
  // Try all N rotations of b matching a's start.
  for (let offset = 0; offset < n; offset++) {
    let ok = true
    for (let i = 0; i < n; i++) {
      const bp = b[(i + offset) % n]
      if (a[i]?.[0] !== bp?.[0] || a[i]?.[1] !== bp?.[1]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  // Reverse winding direction + try all rotations of reversed b.
  const bRev = [...b].reverse()
  for (let offset = 0; offset < n; offset++) {
    let ok = true
    for (let i = 0; i < n; i++) {
      const bp = bRev[(i + offset) % n]
      if (a[i]?.[0] !== bp?.[0] || a[i]?.[1] !== bp?.[1]) {
        ok = false
        break
      }
    }
    if (ok) return true
  }
  return false
}

function cascadeZoneNameToSlabsAndCeilings(
  sceneStore: any,
  changedZones: Array<{ zone: ZoneNodeType; previousName: string }>,
): void {
  if (changedZones.length === 0) return

  const nodes = sceneStore.getState().nodes
  const allSlabs: SlabNodeType[] = []
  const allCeilings: CeilingNodeType[] = []
  for (const node of Object.values(nodes)) {
    const n = node as any
    if (!n) continue
    if (n.type === 'slab' && n.autoFromWalls === true) {
      allSlabs.push(SlabNode.parse(n))
    } else if (n.type === 'ceiling' && n.autoFromWalls === true) {
      allCeilings.push(CeilingNode.parse(n))
    }
  }

  const updates: Array<{ id: string; data: { name: string } }> = []

  for (const { zone } of changedZones) {
    const zonePolygon = zone.polygon as Array<[number, number]>
    const newName = zone.name

    // Znajdź auto-slab z polygon match — rotation-invariant bo slab i
    // zone mogą być detected w innej kolejności wierzchołków mimo że
    // pokrywają identyczny obrys ścian.
    const matchedSlab = allSlabs.find((slab) =>
      samePolygonAnyRotation(slab.polygon as Array<[number, number]>, zonePolygon),
    )
    if (matchedSlab && AUTO_ROOM_NAME_PATTERN.test(matchedSlab.name ?? '')) {
      const expectedName = `${newName} Podłoga`
      if (matchedSlab.name !== expectedName) {
        updates.push({ id: matchedSlab.id, data: { name: expectedName } })
      }
    }

    // Auto-ceiling z polygon match — rotation-invariant (patrz wyżej).
    const matchedCeiling = allCeilings.find((ceiling) =>
      samePolygonAnyRotation(ceiling.polygon as Array<[number, number]>, zonePolygon),
    )
    if (matchedCeiling && AUTO_ROOM_NAME_PATTERN.test(matchedCeiling.name ?? '')) {
      const expectedName = `${newName} Sufit`
      if (matchedCeiling.name !== expectedName) {
        updates.push({ id: matchedCeiling.id, data: { name: expectedName } })
      }
    }
  }

  // GSI fork debug
  if (typeof window !== 'undefined') {
    ;(window as any).__cascadeDebug = {
      changedZones: changedZones.length,
      allSlabs: allSlabs.length,
      allCeilings: allCeilings.length,
      slabPolygonsPreview: allSlabs.slice(0, 3).map((s) => ({
        id: s.id,
        name: s.name,
        firstPoint: s.polygon[0],
      })),
      zonePolygonsPreview: changedZones.map((c) => ({
        id: c.zone.id,
        name: c.zone.name,
        firstPoint: c.zone.polygon[0],
      })),
      updates,
    }
  }

  if (updates.length > 0) {
    sceneStore.getState().updateNodes(updates)
  }
}

export function initSpaceDetectionSync(sceneStore: any, editorStore: any): () => void {
  const previousSnapshots = new Map<string, string>()
  let isProcessingDetection = false

  const unsubscribeDetection = sceneStore.subscribe((state: any) => {
    if (isProcessingDetection) return
    if (getSceneHistoryPauseDepth() > 0) return

    const nodes = state.nodes
    const wallsByLevel = new Map<string, WallNode[]>()

    for (const node of Object.values(nodes)) {
      if (node && (node as any).type === 'wall' && (node as any).parentId) {
        const levelId = (node as any).parentId as string
        const levelWalls = wallsByLevel.get(levelId) ?? []
        levelWalls.push(node as WallNode)
        wallsByLevel.set(levelId, levelWalls)
      }
    }

    const currentSnapshots = new Map<string, string>()
    for (const [levelId, walls] of wallsByLevel.entries()) {
      currentSnapshots.set(levelId, levelWallSnapshot(walls))
    }

    const levelsToUpdate = new Set<string>()
    for (const levelId of new Set([...previousSnapshots.keys(), ...currentSnapshots.keys()])) {
      if ((previousSnapshots.get(levelId) ?? '') !== (currentSnapshots.get(levelId) ?? '')) {
        levelsToUpdate.add(levelId)
      }
    }

    if (levelsToUpdate.size === 0) {
      previousSnapshots.clear()
      for (const [levelId, snapshot] of currentSnapshots.entries()) {
        previousSnapshots.set(levelId, snapshot)
      }
      return
    }

    isProcessingDetection = true
    pauseSceneHistory(sceneStore)
    try {
      runSpaceDetection([...levelsToUpdate], sceneStore, editorStore, nodes)
    } finally {
      resumeSceneHistory(sceneStore)
      previousSnapshots.clear()
      for (const [levelId, snapshot] of currentSnapshots.entries()) {
        previousSnapshots.set(levelId, snapshot)
      }
      isProcessingDetection = false
    }
  })

  // GSI fork: SEPARATE subscriber dla cascade zone rename. Bez
  // getSceneHistoryPauseDepth guard (cascade rename to lightweight op,
  // chcemy reaktywnie aktualizować slab/ceiling names gdy user rename
  // zone — niezależnie od tego czy aktualnie placement tool jest
  // aktywny). Cache ZAWSZE update'owany na końcu — fix bug'a gdzie
  // pause depth uniemożliwiał inicjalne wypełnienie cache po loadzie.
  const previousZoneNames = new Map<string, string>()
  let isProcessingZoneRename = false

  const unsubscribeZoneRename = sceneStore.subscribe((state: any) => {
    if (isProcessingZoneRename) return

    const nodes = state.nodes
    const currentAutoZones = new Map<string, ZoneNodeType>()
    const changedZones: Array<{ zone: ZoneNodeType; previousName: string }> = []

    for (const node of Object.values(nodes)) {
      const n = node as any
      if (!(n && n.type === 'zone' && n.autoFromWalls === true)) continue
      let parsed: ZoneNodeType
      try {
        parsed = ZoneNode.parse(n)
      } catch {
        continue
      }
      currentAutoZones.set(parsed.id, parsed)
      const prev = previousZoneNames.get(parsed.id)
      if (prev !== undefined && prev !== parsed.name) {
        changedZones.push({ zone: parsed, previousName: prev })
      }
    }

    // GSI fork debug: temporary, remove po werify
    if (typeof window !== 'undefined') {
      ;(window as any).__zoneDebug = {
        currentAutoZones: Array.from(currentAutoZones.entries()).map(([id, z]) => ({
          id,
          name: z.name,
          firstPoint: z.polygon[0],
        })),
        previousZoneNames: Array.from(previousZoneNames.entries()),
        changedZones: changedZones.map((c) => ({
          id: c.zone.id,
          from: c.previousName,
          to: c.zone.name,
        })),
      }
    }

    if (changedZones.length > 0) {
      isProcessingZoneRename = true
      try {
        cascadeZoneNameToSlabsAndCeilings(sceneStore, changedZones)
      } finally {
        isProcessingZoneRename = false
      }
    }

    // KRYTYCZNE: cache update PO każdym fire (nawet gdy 0 changed).
    // Bez tego pierwsze fire (gdy żaden zone jeszcze nie był rename'd)
    // nigdy nie wypełni cache — i kolejna zmiana nie zostanie wykryta.
    previousZoneNames.clear()
    for (const [id, zone] of currentAutoZones.entries()) {
      previousZoneNames.set(id, zone.name)
    }
  })

  return () => {
    unsubscribeDetection()
    unsubscribeZoneRename()
  }
}

export function wallTouchesOthers(wall: WallNode, otherWalls: WallNode[]): boolean {
  const threshold = 0.1

  for (const other of otherWalls) {
    if (other.id === wall.id) continue

    if (
      distanceToSegment(wall.start, other.start, other.end) < threshold ||
      distanceToSegment(wall.end, other.start, other.end) < threshold ||
      distanceToSegment(other.start, wall.start, wall.end) < threshold ||
      distanceToSegment(other.end, wall.start, wall.end) < threshold
    ) {
      return true
    }
  }

  return false
}

function distanceToSegment(
  point: [number, number],
  segStart: [number, number],
  segEnd: [number, number],
) {
  const [px, py] = point
  const [x1, y1] = segStart
  const [x2, y2] = segEnd

  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy

  if (lenSq < 0.0001) {
    return Math.hypot(px - x1, py - y1)
  }

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  const projX = x1 + t * dx
  const projY = y1 + t * dy

  return Math.hypot(px - projX, py - projY)
}
