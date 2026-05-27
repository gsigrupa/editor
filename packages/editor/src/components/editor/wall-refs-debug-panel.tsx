'use client'

import { type AnyNode, emitter, type GridEvent, useScene, type WallNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  findNearestWallReferenceSnapAcrossWalls,
  getWallGeometryReferences,
  type Vec3Tuple,
  type WallReferenceSnapResult,
} from '../../lib/wall-geometry-references'

function getWallRefsDebugEnabled() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('wallRefs') === '1'
}

export function WallRefsDebugPanel() {
  const [enabled, setEnabled] = useState(false)
  const [cursorPoint, setCursorPoint] = useState<Vec3Tuple | null>(null)
  const [cursorSnap, setCursorSnap] = useState<WallReferenceSnapResult | null>(null)
  const nodes = useScene((state) => state.nodes as Record<string, AnyNode | undefined>)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodesRef = useRef(nodes)
  const enabledRef = useRef(enabled)
  const rafRef = useRef(0)
  const pendingPointRef = useRef<Vec3Tuple | null>(null)
  const pendingSnapRef = useRef<WallReferenceSnapResult | null>(null)

  nodesRef.current = nodes
  enabledRef.current = enabled

  useEffect(() => {
    const sync = () => setEnabled(getWallRefsDebugEnabled())
    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    const flushCursorSnap = () => {
      rafRef.current = 0
      setCursorPoint(pendingPointRef.current)
      setCursorSnap(pendingSnapRef.current)
    }

    const onMove = (event: GridEvent) => {
      if (!enabledRef.current) return

      const nextPoint = event.localPosition as Vec3Tuple
      const currentNodes = nodesRef.current
      const walls = Object.values(currentNodes).filter(
        (node): node is WallNode => node?.type === 'wall',
      )
      const snap = findNearestWallReferenceSnapAcrossWalls(nextPoint, walls, currentNodes, {
        maxDistance: 0.35,
      })

      pendingPointRef.current = nextPoint
      pendingSnapRef.current = snap
      if (rafRef.current === 0) {
        rafRef.current = window.requestAnimationFrame(flushCursorSnap)
      }
    }

    emitter.on('grid:move', onMove)
    return () => {
      emitter.off('grid:move', onMove)
      if (rafRef.current !== 0) {
        window.cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const summary = useMemo(() => {
    const walls = Object.values(nodes).filter((node): node is WallNode => node?.type === 'wall')
    const refs = walls
      .map((wall) => getWallGeometryReferences(wall, nodes))
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))

    return {
      walls: walls.length,
      faces: refs.reduce((total, ref) => total + ref.faces.length, 0),
      edges: refs.reduce((total, ref) => total + ref.edges.length, 0),
      points: refs.reduce((total, ref) => total + ref.points.length, 0),
      openings: refs.reduce((total, ref) => total + ref.openings.length, 0),
    }
  }, [nodes])

  const selectedWall = selectedIds
    .map((id) => nodes[id])
    .find((node): node is WallNode => node?.type === 'wall')
  const selectedRefs = selectedWall ? getWallGeometryReferences(selectedWall, nodes) : null

  if (!enabled) return null

  return (
    <div className="pointer-events-auto fixed top-20 right-4 z-60 w-72 rounded-xl border border-sky-500/30 bg-white/92 p-3 text-slate-900 text-xs shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-sky-700">Wall refs debug</span>
        <span className="rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] text-sky-800">
          ?wallRefs=1
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
        <span>walls</span>
        <span className="text-right">{summary.walls}</span>
        <span>faces</span>
        <span className="text-right">{summary.faces}</span>
        <span>edges</span>
        <span className="text-right">{summary.edges}</span>
        <span>points</span>
        <span className="text-right">{summary.points}</span>
        <span>openings</span>
        <span className="text-right">{summary.openings}</span>
      </div>
      <div className="mt-3 border-slate-200 border-t pt-2">
        {selectedWall && selectedRefs ? (
          <div className="space-y-1 font-mono">
            <div className="truncate font-semibold text-slate-700">{selectedWall.id}</div>
            <div className="flex justify-between">
              <span>length</span>
              <span>{selectedRefs.length.toFixed(3)} m</span>
            </div>
            <div className="flex justify-between">
              <span>thickness</span>
              <span>{selectedRefs.thickness.toFixed(3)} m</span>
            </div>
            <div className="flex justify-between">
              <span>height</span>
              <span>{selectedRefs.height.toFixed(3)} m</span>
            </div>
          </div>
        ) : (
          <div className="text-slate-500">Select a wall to inspect one wall.</div>
        )}
      </div>
      <div className="mt-3 border-slate-200 border-t pt-2">
        <div className="mb-1 font-semibold text-slate-700">Cursor snap</div>
        {cursorPoint ? (
          <div className="space-y-1 font-mono">
            <div className="flex justify-between">
              <span>cursor</span>
              <span>
                {cursorPoint[0].toFixed(2)}, {cursorPoint[2].toFixed(2)}
              </span>
            </div>
            {cursorSnap ? (
              <>
                <div className="truncate text-slate-700">{cursorSnap.wallId}</div>
                <div className="flex justify-between">
                  <span>kind</span>
                  <span>
                    {cursorSnap.side ? `${cursorSnap.kind}:${cursorSnap.side}` : cursorSnap.kind}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>distance</span>
                  <span>{cursorSnap.distance.toFixed(3)} m</span>
                </div>
                <div className="truncate text-[10px] text-slate-500">{cursorSnap.refId}</div>
              </>
            ) : (
              <div className="text-slate-500">No wall ref in snap range.</div>
            )}
          </div>
        ) : (
          <div className="text-slate-500">Move cursor over the grid.</div>
        )}
      </div>
    </div>
  )
}
