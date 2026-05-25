'use client'

/**
 * GSI fork — visible XYZ axes at site corner (CAD-style reference).
 *
 * Origin = lewy-tylny róg działki (min X, min Z z site polygon w local
 * space). Osie są mountowane jako children site obj przez `createPortal`,
 * więc dziedziczą transform site i podążają za zmianami polygon.
 *
 * Wzorzec analogiczny do `SiteEdgeLabels` — sceneRegistry-poll loop dla
 * site obj, createPortal dla rendering w local space.
 *
 * Boxy zamiast line primitive: Pascal WebGPU pipeline crashował na line
 * primitive + custom node materials (Invalid RenderPipeline). Standard
 * meshBasicMaterial przechodzi OK.
 *
 * Kolory R/G/B:
 *   - X (red)   — `+X` wzdłuż krawędzi działki w prawo
 *   - Y (green) — `+Y` w górę
 *   - Z (blue)  — `+Z` wzdłuż krawędzi działki w głąb
 */

import { sceneRegistry, type SiteNode, useScene } from '@pascal-app/core'
import { createPortal, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import type { Object3D } from 'three'

const AXIS_LENGTH = 30 // m — od rogu w prawo / w głąb / w górę
const AXIS_THICKNESS = 0.005 // 5 mm
const HALF = AXIS_LENGTH / 2

export function SceneAxes() {
  // Subscribe tylko do site root — analogicznie SiteEdgeLabels.
  const siteNode = useScene((state) => {
    const firstRoot = state.rootNodeIds[0]
    if (!firstRoot) return null
    const node = state.nodes[firstRoot]
    return node?.type === 'site' ? (node as SiteNode) : null
  })

  const siteNodeId = siteNode?.id
  const [siteObj, setSiteObj] = useState<Object3D | null>(null)
  const prevSiteNodeIdRef = useRef<string | undefined>(undefined)

  // Poll każdy frame aż site group się zarejestruje (reset gdy zmiana ID).
  useFrame(() => {
    if (siteNodeId !== prevSiteNodeIdRef.current) {
      prevSiteNodeIdRef.current = siteNodeId
      setSiteObj(null)
      return
    }
    if (siteObj || !siteNodeId) return
    const obj = sceneRegistry.nodes.get(siteNodeId)
    if (obj) setSiteObj(obj)
  })

  // Lewy-tylny róg w local space (min X, min Z z polygon points).
  const corner = useMemo<[number, number]>(() => {
    const points = siteNode?.polygon?.points
    const first = points?.[0]
    if (!points || points.length === 0 || !first) return [0, 0]
    let minX = first[0]
    let minZ = first[1]
    for (const [x, z] of points) {
      if (x < minX) minX = x
      if (z < minZ) minZ = z
    }
    return [minX, minZ]
  }, [siteNode?.polygon?.points])

  if (!siteObj) return null

  const [cornerX, cornerZ] = corner
  return createPortal(
    <group position={[cornerX, 0, cornerZ]}>
      {/* X axis — red, od rogu w prawo */}
      <mesh castShadow={false} position={[HALF, 0, 0]} receiveShadow={false}>
        <boxGeometry args={[AXIS_LENGTH, AXIS_THICKNESS, AXIS_THICKNESS]} />
        <meshBasicMaterial color="#ef4444" depthTest={false} opacity={0.85} transparent />
      </mesh>
      {/* Y axis — green, od rogu w górę */}
      <mesh castShadow={false} position={[0, HALF, 0]} receiveShadow={false}>
        <boxGeometry args={[AXIS_THICKNESS, AXIS_LENGTH, AXIS_THICKNESS]} />
        <meshBasicMaterial color="#22c55e" depthTest={false} opacity={0.85} transparent />
      </mesh>
      {/* Z axis — blue, od rogu w głąb */}
      <mesh castShadow={false} position={[0, 0, HALF]} receiveShadow={false}>
        <boxGeometry args={[AXIS_THICKNESS, AXIS_THICKNESS, AXIS_LENGTH]} />
        <meshBasicMaterial color="#3b82f6" depthTest={false} opacity={0.85} transparent />
      </mesh>
    </group>,
    siteObj,
  )
}
