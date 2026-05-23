import type { NodeDefinition } from '@pascal-app/core'
import { buildWindowFloorplan } from './floorplan'
import { windowFloorplanMoveTarget } from './floorplan-move'
import { windowParametrics } from './parametrics'
import { WindowNode } from './schema'

/**
 * Window — Phase 5 batch kind. Mirrors door's shape: hosted on walls,
 * cuts holes in them, animated open/close state for opening windows.
 *
 * Stages:
 *  - A: registered.
 *  - B: deferred — window geometry ~800 lines; extraction is a focused
 *    session. `def.renderer` + `def.system` wrap-export legacy.
 *  - C: `def.floorplan` polygon sits in parent wall's cutout. Legacy
 *    `openingPolygons` short-circuits window entries when registered.
 */
export const windowDefinition: NodeDefinition<typeof WindowNode> = {
  kind: 'window',
  schemaVersion: 1,
  schema: WindowNode,
  category: 'structure',

  // Same schema-driven defaults trick as door: parse a stub, strip
  // id/type. Window also has many fields with zod `.default()` set.
  defaults: () => {
    const stub = WindowNode.parse({ id: 'window_default' as never, type: 'window' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: windowParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  // Stage C: floor-plan polygon. ctx.parent gives the wall for direction
  // + thickness — same shape as door.
  floorplan: buildWindowFloorplan,
  // Stage D — placement + move-on-wall. Same recipe as door. See
  // `nodes/src/window/{tool,move-tool,window-math}.ts`.
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  // 2D move-on-floorplan handler — same shape as door.
  floorplanMoveTarget: windowFloorplanMoveTarget,

  toolHints: [
    { key: 'Lewy klik', label: 'Umieść okno na ścianie' },
    { key: 'Esc', label: 'Anuluj' },
  ],

  presentation: {
    label: 'Okno',
    description: 'Okno wycięte w ścianie. Animowane otwieranie/zamykanie dla okien uchylnych.',
    icon: { kind: 'url', src: '/icons/window.png' },
    paletteSection: 'structure',
    paletteOrder: 60,
  },

  mcp: {
    description: 'Okno zamontowane w ścianie, z typem / wymiarami / opcjami otwierania.',
  },
}
