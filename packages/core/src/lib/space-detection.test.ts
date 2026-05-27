import { describe, expect, test } from 'bun:test'
import { WallNode, type WallNode as WallNodeType, ZoneNode } from '../schema'
import { detectSpacesForLevel, planAutoZonesForLevel } from './space-detection'

function wall(start: [number, number], end: [number, number]): WallNodeType {
  return WallNode.parse({
    start,
    end,
  })
}

describe('detectSpacesForLevel', () => {
  test('detects one room from a closed rectangle', () => {
    const result = detectSpacesForLevel('level_test', [
      wall([0, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [0, 3]),
      wall([0, 3], [0, 0]),
    ])

    expect(result.roomPolygons).toHaveLength(1)
    expect(result.spaces).toHaveLength(1)
  })

  test('detects two rooms when a closed rectangle is split by a partition wall', () => {
    const result = detectSpacesForLevel('level_test', [
      wall([0, 0], [2, 0]),
      wall([2, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [2, 3]),
      wall([2, 3], [0, 3]),
      wall([0, 3], [0, 0]),
      wall([2, 0], [2, 3]),
    ])

    expect(result.roomPolygons).toHaveLength(2)
    expect(result.spaces).toHaveLength(2)
  })
})

describe('planAutoZonesForLevel', () => {
  test('keeps default room naming aligned after splitting an auto zone', () => {
    const rooms = detectSpacesForLevel('level_test', [
      wall([0, 0], [2, 0]),
      wall([2, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [2, 3]),
      wall([2, 3], [0, 3]),
      wall([0, 3], [0, 0]),
      wall([2, 0], [2, 3]),
    ]).roomPolygons

    const existingZone = ZoneNode.parse({
      name: 'Pomieszczenie 1',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })

    const plan = planAutoZonesForLevel(rooms, [existingZone])
    const names = plan.create.map((zone) => zone.name).sort()

    expect(plan.delete).toContain(existingZone.id)
    expect(names).toEqual(['Pomieszczenie 1', 'Pomieszczenie 2'])
  })

  test('keeps custom room naming inheritance after splitting an auto zone', () => {
    const rooms = detectSpacesForLevel('level_test', [
      wall([0, 0], [2, 0]),
      wall([2, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [2, 3]),
      wall([2, 3], [0, 3]),
      wall([0, 3], [0, 0]),
      wall([2, 0], [2, 3]),
    ]).roomPolygons

    const existingZone = ZoneNode.parse({
      name: 'Salon',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })

    const plan = planAutoZonesForLevel(rooms, [existingZone])
    const names = plan.create.map((zone) => zone.name).sort()

    expect(plan.delete).toContain(existingZone.id)
    expect(names).toEqual(['Salon', 'Salon 2'])
  })
})
