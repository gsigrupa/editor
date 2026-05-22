import type { AnyNode } from '@pascal-app/core'

export type NodeDisplay = {
  icon: string
  label: string
}

const TYPE_DEFAULTS: Record<string, NodeDisplay> = {
  item: { icon: '/icons/furniture.png', label: 'Element' },
  wall: { icon: '/icons/wall.png', label: 'Ściana' },
  door: { icon: '/icons/door.png', label: 'Drzwi' },
  window: { icon: '/icons/window.png', label: 'Okno' },
  slab: { icon: '/icons/floor.png', label: 'Płyta podłogowa' },
  ceiling: { icon: '/icons/ceiling.png', label: 'Sufit' },
  column: { icon: '/icons/column.png', label: 'Słup' },
  elevator: { icon: '/icons/elevator.png', label: 'Winda' },
  fence: { icon: '/icons/fence.png', label: 'Ogrodzenie' },
  roof: { icon: '/icons/roof.png', label: 'Dach' },
  'roof-segment': { icon: '/icons/roof.png', label: 'Segment dachu' },
  stair: { icon: '/icons/stair.png', label: 'Schody' },
  'stair-segment': { icon: '/icons/stair.png', label: 'Segment schodów' },
  scan: { icon: '/icons/mesh.png', label: 'Skan 3D' },
  guide: { icon: '/icons/floorplan.png', label: 'Obraz pomocniczy' },
}

export function getNodeDisplay(node: AnyNode | null | undefined): NodeDisplay {
  if (!node) return { icon: '/icons/select.png', label: 'Zaznaczenie' }
  const fallback = TYPE_DEFAULTS[node.type] ?? { icon: '/icons/select.png', label: node.type }
  // Item nodes carry an asset with its own thumbnail/name
  if (node.type === 'item') {
    return {
      icon: node.asset?.thumbnail || fallback.icon,
      label: node.name || node.asset?.name || fallback.label,
    }
  }
  return {
    icon: fallback.icon,
    label: node.name || fallback.label,
  }
}
