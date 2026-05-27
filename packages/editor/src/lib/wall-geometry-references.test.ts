import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  DoorNode,
  type DoorNode as DoorNodeType,
  WallNode,
  type WallNode as WallNodeType,
  WindowNode,
  type WindowNode as WindowNodeType,
} from '@pascal-app/core/schema'
import {
  findNearestWallReferenceSnap,
  findNearestWallReferenceSnapAcrossWalls,
  getWallGeometryReferences,
  getWallLevelGeometryReferences,
  wallReferenceSnapToCenterlinePoint,
  wallLocalToLevelPoint,
  wallLevelToLocalPoint,
} from './wall-geometry-references'

function makeWall(overrides: Partial<WallNodeType> = {}): WallNodeType {
  return WallNode.parse({
    id: 'wall_test',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    height: 3,
    children: [],
    ...overrides,
  })
}

function makeDoor(overrides: Partial<DoorNodeType> = {}): DoorNodeType {
  return DoorNode.parse({
    id: 'door_test',
    wallId: 'wall_test',
    side: 'front',
    position: [2, 1.05, 0],
    width: 0.9,
    height: 2.1,
    ...overrides,
  })
}

function makeWindow(overrides: Partial<WindowNodeType> = {}): WindowNodeType {
  return WindowNode.parse({
    id: 'window_test',
    wallId: 'wall_test',
    side: 'back',
    position: [3, 1.3, 0],
    width: 1.2,
    height: 1,
    ...overrides,
  })
}

function nodesById(nodes: AnyNode[]) {
  return Object.fromEntries(nodes.map((node) => [node.id, node]))
}

describe('getWallGeometryReferences', () => {
  test('builds stable wall-local references for a straight wall', () => {
    const wall = makeWall()
    const refs = getWallGeometryReferences(wall, nodesById([wall]))

    expect(refs).not.toBeNull()
    expect(refs!.length).toBe(4)
    expect(refs!.thickness).toBe(0.2)
    expect(refs!.height).toBe(3)
    expect(refs!.faces).toHaveLength(6)
    expect(refs!.edges).toHaveLength(12)
    expect(refs!.points).toHaveLength(10)
    expect(refs!.openings).toHaveLength(0)

    const frontFace = refs!.faces.find((face) => face.side === 'front')
    const backFace = refs!.faces.find((face) => face.side === 'back')
    expect(frontFace?.center).toEqual([2, 1.5, 0.1])
    expect(backFace?.center).toEqual([2, 1.5, -0.1])
  })

  test('adds door opening references on the selected wall side', () => {
    const door = makeDoor()
    const wall = makeWall({ children: [door.id] })
    const refs = getWallGeometryReferences(wall, nodesById([wall, door]))

    expect(refs).not.toBeNull()
    expect(refs!.openings).toHaveLength(1)
    expect(refs!.points).toHaveLength(15)
    expect(refs!.edges).toHaveLength(16)

    const opening = refs!.openings[0]!
    expect(opening.kind).toBe('door')
    expect(opening.left).toBeCloseTo(1.55)
    expect(opening.right).toBeCloseTo(2.45)
    expect(opening.bottom).toBe(0)
    expect(opening.top).toBeCloseTo(2.1)
    expect(opening.points.find((point) => point.id.endsWith(':center'))?.position).toEqual([
      2,
      1.05,
      0.1,
    ])
  })

  test('adds window opening references without losing the back wall side', () => {
    const window = makeWindow()
    const wall = makeWall({ children: [window.id] })
    const refs = getWallGeometryReferences(wall, nodesById([wall, window]))

    expect(refs).not.toBeNull()
    expect(refs!.openings).toHaveLength(1)

    const opening = refs!.openings[0]!
    expect(opening.kind).toBe('window')
    expect(opening.left).toBeCloseTo(2.4)
    expect(opening.right).toBeCloseTo(3.6)
    expect(opening.bottom).toBeCloseTo(0.8)
    expect(opening.top).toBeCloseTo(1.8)
    expect(opening.points.find((point) => point.id.endsWith(':center'))?.position).toEqual([
      3,
      1.3,
      -0.1,
    ])
  })

  test('returns null for a degenerate wall segment', () => {
    const wall = makeWall({ start: [1, 1], end: [1, 1] })

    expect(getWallGeometryReferences(wall, nodesById([wall]))).toBeNull()
    expect(getWallLevelGeometryReferences(wall, nodesById([wall]))).toBeNull()
    expect(wallLocalToLevelPoint(wall, [0, 0, 0])).toBeNull()
  })

  test('projects wall-local references into level coordinates', () => {
    const wall = makeWall({ start: [1, 2], end: [5, 2] })
    const refs = getWallLevelGeometryReferences(wall, nodesById([wall]))

    expect(refs).not.toBeNull()
    expect(refs!.local.faces.find((face) => face.side === 'front')?.center).toEqual([
      2,
      1.5,
      0.1,
    ])
    expect(refs!.faces.find((face) => face.side === 'front')?.center).toEqual([3, 1.5, 2.1])
    expect(refs!.faces.find((face) => face.side === 'back')?.center).toEqual([3, 1.5, 1.9])
    expect(wallLocalToLevelPoint(wall, [4, 0, 0.1])).toEqual([5, 0, 2.1])
    const localPoint = wallLevelToLocalPoint(wall, [5, 0, 2.1])
    expect(localPoint).not.toBeNull()
    expect(localPoint![0]).toBeCloseTo(4)
    expect(localPoint![1]).toBeCloseTo(0)
    expect(localPoint![2]).toBeCloseTo(0.1)
  })

  test('keeps front and back stable on a rotated wall', () => {
    const wall = makeWall({ start: [1, 2], end: [1, 6] })
    const refs = getWallLevelGeometryReferences(wall, nodesById([wall]))

    expect(refs).not.toBeNull()
    expect(refs!.faces.find((face) => face.side === 'front')?.center).toEqual([0.9, 1.5, 4])
    expect(refs!.faces.find((face) => face.side === 'back')?.center).toEqual([1.1, 1.5, 4])
    expect(wallLocalToLevelPoint(wall, [4, 0, 0.1])).toEqual([0.9, 0, 6])
  })

  test('snaps to the nearest wall face from a level point', () => {
    const wall = makeWall({ start: [1, 2], end: [5, 2] })
    const snap = findNearestWallReferenceSnap([3, 1.2, 2.16], wall, nodesById([wall]))

    expect(snap).not.toBeNull()
    expect(snap!.kind).toBe('face')
    expect(snap!.side).toBe('front')
    expect(snap!.position).toEqual([3, 1.2, 2.103])
    expect(snap!.localPosition).toEqual([2, 1.2, 0.10300000000000001])
    expect(snap!.distance).toBeCloseTo(0.057)
  })

  test('projects face snaps back to wall centerline for topology-safe wall building', () => {
    const wall = makeWall({ start: [1, 2], end: [5, 2], thickness: 0.2 })
    const snap = findNearestWallReferenceSnap([3, 0, 2.16], wall, nodesById([wall]))

    expect(snap).not.toBeNull()
    expect(snap!.kind).toBe('face')
    expect(snap!.side).toBe('front')

    const topologyPoint = wallReferenceSnapToCenterlinePoint(wall, snap!)

    expect(topologyPoint).toEqual([3, 0, 2])
  })

  test('snaps to edges and points when those reference groups are targeted', () => {
    const wall = makeWall({ start: [1, 2], end: [5, 2] })
    const nodes = nodesById([wall])

    const edgeSnap = findNearestWallReferenceSnap([3, 3.08, 2.1], wall, nodes, {
      includeFaces: false,
    })
    expect(edgeSnap).not.toBeNull()
    expect(edgeSnap!.kind).toBe('edge')
    expect(edgeSnap!.refId).toBe('wall_test:front:top')
    expect(edgeSnap!.position).toEqual([3, 3, 2.1])

    const pointSnap = findNearestWallReferenceSnap([1, 0, 2.1], wall, nodes)
    expect(pointSnap).not.toBeNull()
    expect(pointSnap!.kind).toBe('point')
    expect(pointSnap!.refId).toBe('wall_test:front:start:bottom')
  })

  test('can ignore wall points so build snapping does not over-grab corners', () => {
    const wall = makeWall({ start: [1, 2], end: [5, 2] })
    const nodes = nodesById([wall])

    const snap = findNearestWallReferenceSnap([1.12, 0, 2.08], wall, nodes, {
      includePoints: false,
    })

    expect(snap).not.toBeNull()
    expect(snap!.kind).not.toBe('point')
  })

  test('finds the nearest snap across multiple walls', () => {
    const nearWall = makeWall({ id: 'wall_near', start: [0, 0], end: [4, 0] })
    const farWall = makeWall({ id: 'wall_far', start: [10, 0], end: [14, 0] })
    const nodes = nodesById([nearWall, farWall])
    const snap = findNearestWallReferenceSnapAcrossWalls([3, 1, 0.14], [nearWall, farWall], nodes)

    expect(snap).not.toBeNull()
    expect(snap!.wallId).toBe('wall_near')
    expect(snap!.side).toBe('front')
  })
})
