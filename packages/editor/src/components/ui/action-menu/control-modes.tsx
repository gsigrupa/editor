'use client'

import { Icon } from '@iconify/react'
import { Eraser, Ruler, type LucideIcon } from 'lucide-react'
import Image from 'next/image'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import { ActionButton } from './action-button'

type ControlId =
  | 'select'
  | 'box-select'
  | 'measure'
  | 'build'
  | 'material-paint'
  | 'furnish'
  | 'zone'
  | 'eraser'

type ControlConfig = {
  id: ControlId
  icon?: LucideIcon
  iconifyIcon?: string
  imageSrc?: string
  label: string
  shortcut?: string
  color: string
  activeColor: string
}

// Fixed set of controls — always visible, never morphs
const controls: ControlConfig[] = [
  {
    id: 'select',
    imageSrc: '/icons/select.png',
    label: 'Zaznacz',
    // GSI fork: Spacja jako głowny shortcut (SketchUp convention), V jako alias.
    // Symbol '␣' (U+2423 OPEN BOX) konwencja dla klawisza Space w UI shortcut badges.
    shortcut: '␣',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'box-select',
    iconifyIcon: 'mdi:select-drag',
    label: 'Zaznacz prostokątem',
    color: 'hover:bg-white/5',
    activeColor: 'bg-white/10 hover:bg-white/10',
  },
  {
    id: 'measure',
    icon: Ruler,
    label: 'Miarka',
    shortcut: 'T',
    color: 'hover:bg-purple-500/20 hover:text-purple-400',
    activeColor: 'bg-purple-500/20 text-purple-400',
  },
  {
    id: 'build',
    imageSrc: '/icons/build.png',
    label: 'Buduj',
    shortcut: 'B',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'material-paint',
    imageSrc: '/icons/paint.png',
    label: 'Materiały',
    shortcut: 'P',
    color: 'hover:bg-amber-500/20 hover:text-amber-400',
    activeColor: 'bg-amber-500/20 text-amber-400',
  },
  {
    id: 'furnish',
    imageSrc: '/icons/couch.png',
    label: 'Umebluj',
    shortcut: 'F',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'zone',
    imageSrc: '/icons/zone.png',
    label: 'Strefa',
    shortcut: 'Z',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'eraser',
    icon: Eraser,
    label: 'Gumka',
    shortcut: 'E',
    color: 'hover:bg-red-500/20 hover:text-red-400',
    activeColor: 'bg-red-500/20 text-red-400',
  },
]

export function ControlModes() {
  const mode = useEditor((state) => state.mode)
  const phase = useEditor((state) => state.phase)
  const tool = useEditor((state) => state.tool)
  const selectionTool = useEditor((state) => state.floorplanSelectionTool)
  const setMode = useEditor((state) => state.setMode)
  const setPhase = useEditor((state) => state.setPhase)
  const setTool = useEditor((state) => state.setTool)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setSelectionTool = useEditor((state) => state.setFloorplanSelectionTool)
  const primeMaterialPaintFromSelection = useEditor(
    (state) => state.primeMaterialPaintFromSelection,
  )
  const isSiteEditing = phase === 'site'

  const structureLayer = useEditor((state) => state.structureLayer)

  const getIsActive = (id: ControlId): boolean => {
    if (isSiteEditing) return false
    if (id === 'select') return mode === 'select' && selectionTool === 'click'
    if (id === 'box-select') return mode === 'select' && selectionTool === 'marquee'
    if (id === 'measure')
      return (
        mode === 'build' &&
        phase === 'structure' &&
        structureLayer === 'elements' &&
        tool === 'measure'
      )
    if (id === 'build')
      return mode === 'build' && phase === 'structure' && structureLayer === 'elements'
    if (id === 'material-paint') return mode === 'material-paint'
    if (id === 'furnish') return mode === 'build' && phase === 'furnish'
    if (id === 'zone')
      return mode === 'build' && phase === 'structure' && structureLayer === 'zones'
    if (id === 'eraser')
      return (
        mode === 'build' &&
        phase === 'structure' &&
        structureLayer === 'elements' &&
        tool === 'eraser'
      )
    return mode === id
  }

  const handleClick = (id: ControlId) => {
    // Exit site editing first if needed
    if (isSiteEditing) {
      setPhase('structure')
      setStructureLayer('elements')
    }

    if (id === 'select') {
      setMode('select')
      setSelectionTool('click')
    } else if (id === 'box-select') {
      setMode('select')
      setSelectionTool('marquee')
    } else if (id === 'measure') {
      if (getIsActive('measure')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('elements')
        setMode('build')
        setTool('measure')
      }
    } else if (id === 'build') {
      // Toggle: if already in structure build, go back to select
      if (getIsActive('build')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('elements')
        setMode('build')
      }
    } else if (id === 'material-paint') {
      if (getIsActive('material-paint')) {
        setMode('select')
      } else {
        primeMaterialPaintFromSelection()
        setPhase('structure')
        setStructureLayer('elements')
        setMode('material-paint')
      }
    } else if (id === 'furnish') {
      if (getIsActive('furnish')) {
        setMode('select')
      } else {
        setPhase('furnish')
        setMode('build')
        // Auto-switch sidebar to the items panel so the user can pick furniture
        useEditor.getState().setActiveSidebarPanel('items')
      }
    } else if (id === 'zone') {
      if (getIsActive('zone')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('zones')
        setMode('build')
      }
    } else if (id === 'eraser') {
      if (getIsActive('eraser')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('elements')
        setMode('build')
        setTool('eraser')
      }
    } else {
      setMode(id)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {controls.map((c) => {
        const ModeIcon = c.icon
        const isImageMode = Boolean(c.imageSrc)
        const isActive = getIsActive(c.id)

        return (
          <ActionButton
            aria-label={c.shortcut ? `${c.label} ${c.shortcut}` : c.label}
            className={cn(
              'group text-muted-foreground',
              !(isImageMode || isActive) && c.color,
              !isImageMode && isActive && c.activeColor,
              isImageMode && isActive && 'bg-white/10 hover:bg-white/10',
              isImageMode && !isActive && 'hover:bg-white/5',
            )}
            key={c.id}
            label={c.label}
            onClick={() => handleClick(c.id)}
            shortcut={c.shortcut}
            size="icon"
            variant="ghost"
          >
            {c.imageSrc ? (
              <Image
                alt={c.label}
                className={cn(
                  'h-[28px] w-[28px] object-contain transition-[opacity,filter] duration-200',
                  isActive
                    ? 'opacity-100 grayscale-0'
                    : 'opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0',
                )}
                height={28}
                src={c.imageSrc}
                width={28}
              />
            ) : c.iconifyIcon ? (
              <Icon color="currentColor" height={18} icon={c.iconifyIcon} width={18} />
            ) : (
              ModeIcon && <ModeIcon className="h-5 w-5" />
            )}
          </ActionButton>
        )
      })}
    </div>
  )
}
