'use client'

import NextImage from 'next/image'
import { useContextualTools } from '../../../hooks/use-contextual-tools'

import { cn } from '../../../lib/utils'
import useEditor, {
  type CatalogCategory,
  type StructureTool,
  type Tool,
} from '../../../store/use-editor'
import { ActionButton } from './action-button'

export type ToolConfig = {
  id: StructureTool
  iconSrc: string
  label: string
  catalogCategory?: CatalogCategory
}

export const tools: ToolConfig[] = [
  { id: 'wall', iconSrc: '/icons/wall.png', label: 'Ściana' },
  { id: 'door', iconSrc: '/icons/door.png', label: 'Drzwi' },
  { id: 'window', iconSrc: '/icons/window.png', label: 'Okno' },
  { id: 'stair', iconSrc: '/icons/stairs.png', label: 'Schody' },
  { id: 'roof', iconSrc: '/icons/roof.png', label: 'Dach dwuspadowy' },
  { id: 'fence', iconSrc: '/icons/fence.png', label: 'Ogrodzenie' },
  { id: 'column', iconSrc: '/icons/column.png', label: 'Słup' },
  { id: 'elevator', iconSrc: '/icons/elevator.png', label: 'Winda' },
  { id: 'slab', iconSrc: '/icons/floor.png', label: 'Płyta podłogowa' },
  { id: 'ceiling', iconSrc: '/icons/ceiling.png', label: 'Sufit' },
  { id: 'zone', iconSrc: '/icons/zone.png', label: 'Strefa' },
  { id: 'spawn', iconSrc: '/icons/site.png', label: 'Punkt startowy' },
  { id: 'shelf', iconSrc: '/icons/shelf.png', label: 'Półka' },
]

export function StructureTools() {
  const activeTool = useEditor((state) => state.tool)
  const catalogCategory = useEditor((state) => state.catalogCategory)
  const structureLayer = useEditor((state) => state.structureLayer)
  const setTool = useEditor((state) => state.setTool)
  const setCatalogCategory = useEditor((state) => state.setCatalogCategory)

  const contextualTools = useContextualTools()

  // Filter tools based on structureLayer
  const visibleTools =
    structureLayer === 'zones'
      ? tools.filter((t) => t.id === 'zone')
      : tools.filter((t) => t.id !== 'zone')

  const hasActiveTool = visibleTools.some(
    (t) =>
      activeTool === t.id && (t.catalogCategory ? catalogCategory === t.catalogCategory : true),
  )

  return (
    <div className="flex items-center gap-1.5 px-1">
      {visibleTools.map((tool, index) => {
        // For item tools with catalog category, check both tool and category match
        const isActive =
          activeTool === tool.id &&
          (tool.catalogCategory ? catalogCategory === tool.catalogCategory : true)

        const isContextual = contextualTools.includes(tool.id)

        return (
          <ActionButton
            className={cn(
              'rounded-lg duration-300',
              isActive
                ? 'z-10 scale-110 bg-foreground/10 hover:bg-foreground/15'
                : 'scale-95 bg-transparent opacity-60 grayscale hover:bg-foreground/10 hover:opacity-100 hover:grayscale-0',
            )}
            key={`${tool.id}-${tool.catalogCategory ?? index}`}
            label={tool.label}
            onClick={() => {
              if (!isActive) {
                setTool(tool.id)
                setCatalogCategory(tool.catalogCategory ?? null)

                // Automatically switch to build mode if we select a tool
                if (useEditor.getState().mode !== 'build') {
                  useEditor.getState().setMode('build')
                }
              }
            }}
            size="icon"
            variant="ghost"
          >
            <NextImage
              alt={tool.label}
              className="size-full object-contain"
              height={28}
              src={tool.iconSrc}
              width={28}
            />
          </ActionButton>
        )
      })}
    </div>
  )
}
