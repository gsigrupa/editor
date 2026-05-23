'use client'

/**
 * GSI fork — SketchUp-style tape measure tool ("M" key).
 *
 * Etap A (MVP): klik 1 → ustawia start point z snapem corner/edge/grid
 * (reuse `snapWallDraftPoint`). Cursor → live HUD "X cm / X m" wzdłuż
 * preview line. Klik 2 → finalizuje pomiar (zostaje na ekranie do
 * następnego klika lub Esc).
 *
 * Bez persistence (Etap B doda `measure-guide` kind). Bez numeric
 * input (Etap C doda numeric → guide at exact distance).
 *
 * Esc:
 *   - Stan "measuring" (klik 1 zrobiony, czekamy na klik 2) → reset do idle
 *   - Stan "done" (po klik 2) → wyczyść finalny pomiar do idle
 *   - Stan idle → propagate Esc (tool:cancel exit do select)
 */

import {
  emitter,
  type GridEvent,
  type WallNode,
  useScene,
} from '@pascal-app/core'
// Plik wewnątrz pakietu editor — relative imports, nie '@pascal-app/editor'
// (uniknięcie circular self-reference w monorepo build).
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { snapWallDraftPoint } from '../wall/wall-drafting'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'

const MEASURE_COLOR = '#dc2626' // red-600, kontrast vs niebieskich wall preview
const MEASURE_SHADOW = '#ffffff'
const HUD_OFFSET = 0.02 // 2cm nad linią Y żeby HUD nie ginął w geometrii

interface MeasurePoint {
  x: number
  z: number
  y: number
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
  if (lengthUnit === 'cm') {
    return `${(meters * 100).toFixed(1)} cm`
  }
  if (lengthUnit === 'mm') {
    return `${(meters * 1000).toFixed(0)} mm`
  }
  return `${meters.toFixed(2)} m`
}

export const MeasureTool: React.FC = () => {
  // Stan: ostatni klik (start) + bieżący cursor (end). Gdy `done` = true,
  // klik 2 zafiksował end. Następny klik resetuje.
  const startRef = useRef<MeasurePoint | null>(null)

  // State (re-render): end point + done flag — używane do HUD.
  const [endPoint, setEndPoint] = useState<MeasurePoint | null>(null)
  const [start, setStart] = useState<MeasurePoint | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const reset = () => {
      startRef.current = null
      setStart(null)
      setEndPoint(null)
      setDone(false)
    }

    const onGridMove = (event: GridEvent) => {
      if (!startRef.current || done) return
      const walls = getCurrentLevelWalls()
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
        start: [startRef.current.x, startRef.current.z],
        angleSnap: false, // miarka mierzy raw distance, nie snap angle
      })
      setEndPoint({ x: snapped[0], z: snapped[1], y: event.localPosition[1] })
    }

    const onGridClick = (event: GridEvent) => {
      const walls = getCurrentLevelWalls()
      const snapped = snapWallDraftPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        walls,
      })
      const point: MeasurePoint = { x: snapped[0], z: snapped[1], y: event.localPosition[1] }

      if (done) {
        // Stan "po pomiarze" — nowy klik = start nowego pomiaru.
        startRef.current = point
        setStart(point)
        setEndPoint(point)
        setDone(false)
        return
      }
      if (!startRef.current) {
        // Pierwszy klik — ustaw start.
        startRef.current = point
        setStart(point)
        setEndPoint(point)
        return
      }
      // Drugi klik — finalizuj pomiar.
      setEndPoint(point)
      setDone(true)
    }

    const onCancel = () => {
      if (startRef.current || done) {
        markToolCancelConsumed()
        reset()
      }
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [done])

  // Render: linia start→end + HUD z odległością na środku.
  if (!start || !endPoint) return null

  const dx = endPoint.x - start.x
  const dz = endPoint.z - start.z
  const distance = Math.hypot(dx, dz)
  if (distance < 0.001) return null

  const midX = (start.x + endPoint.x) / 2
  const midZ = (start.z + endPoint.z) / 2
  const midY = (start.y + endPoint.y) / 2 + HUD_OFFSET

  return <MeasureRender end={endPoint} mid={[midX, midY, midZ]} start={start} text={formatLength(distance)} />
}

// Render zewnętrzny — Etap A używa wyłącznie HTML overlays (przez Html
// z drei) zamiast 3D meshes (line, sphere). Powód: Pascal WebGPU r184
// jest agresywnie wybredny na material types — meshStandardMaterial +
// emissive cras pipeline ("Invalid RenderPipeline_MeshLambertNodeMaterial").
// lineBasicNodeMaterial + line primitive też sypał. Dopiero Etap B (kind
// `measure-guide` zarejestrowany w nodeRegistry) przechodzi przez
// pełny renderer pipeline. Na Etap A: 3 HTML overlay'e — 2 kropki na
// końcach + label ze środka — bez touche'owania WebGPU pipeline.
function MeasureRender({
  end,
  mid,
  start,
  text,
}: {
  end: MeasurePoint
  mid: [number, number, number]
  start: MeasurePoint
  text: string
}) {
  return (
    <>
      <Html
        center
        position={[start.x, start.y + HUD_OFFSET / 2, start.z]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          style={{
            background: MEASURE_COLOR,
            border: `2px solid ${MEASURE_SHADOW}`,
            borderRadius: '50%',
            height: 14,
            width: 14,
          }}
        />
      </Html>
      <Html
        center
        position={[end.x, end.y + HUD_OFFSET / 2, end.z]}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          style={{
            background: MEASURE_COLOR,
            border: `2px solid ${MEASURE_SHADOW}`,
            borderRadius: '50%',
            height: 14,
            width: 14,
          }}
        />
      </Html>
      <Html
        center
        position={mid}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
        zIndexRange={[100, 0]}
      >
        <div
          className="whitespace-nowrap font-bold font-mono text-[15px]"
          style={{
            color: MEASURE_COLOR,
            textShadow: `-1.5px -1.5px 0 ${MEASURE_SHADOW}, 1.5px -1.5px 0 ${MEASURE_SHADOW}, -1.5px 1.5px 0 ${MEASURE_SHADOW}, 1.5px 1.5px 0 ${MEASURE_SHADOW}, 0 0 4px ${MEASURE_SHADOW}, 0 0 4px ${MEASURE_SHADOW}`,
          }}
        >
          {text}
        </div>
      </Html>
    </>
  )
}
