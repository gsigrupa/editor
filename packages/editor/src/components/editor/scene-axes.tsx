'use client'

/**
 * GSI fork — visible XYZ axes at origin (CAD-style reference).
 *
 * 3 boxy (cienkie wytrzymane prostopadłościany 5mm × 30m) zamiast
 * line primitive — boxy mają vertex buffer wymagany przez Pascal
 * WebGPU pipeline (line primitive + custom node materials sypał
 * "Invalid RenderPipeline"). Standard Three.js meshBasicMaterial
 * przechodzi przez Pascal renderer pipeline bez crash'a.
 *
 * Kolory R/G/B convention:
 *   - X (red)   — `+X` w prawą stronę (in Three.js right-handed coord)
 *   - Y (green) — `+Y` w górę
 *   - Z (blue)  — `+Z` ku obserwatorowi
 *
 * Position 0 = origin sceny. Length 30m w każdym kierunku (od -15 do
 * +15), grubość 5mm żeby widoczne ale subtle.
 */

const AXIS_LENGTH = 30 // m — full span -15 do +15
const AXIS_THICKNESS = 0.005 // 5 mm

export function SceneAxes() {
  return (
    <group>
      {/* X axis — red */}
      <mesh castShadow={false} position={[0, 0, 0]} receiveShadow={false}>
        <boxGeometry args={[AXIS_LENGTH, AXIS_THICKNESS, AXIS_THICKNESS]} />
        <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.7} />
      </mesh>
      {/* Y axis — green (up) */}
      <mesh castShadow={false} position={[0, 0, 0]} receiveShadow={false}>
        <boxGeometry args={[AXIS_THICKNESS, AXIS_LENGTH, AXIS_THICKNESS]} />
        <meshBasicMaterial color="#22c55e" depthTest={false} transparent opacity={0.7} />
      </mesh>
      {/* Z axis — blue */}
      <mesh castShadow={false} position={[0, 0, 0]} receiveShadow={false}>
        <boxGeometry args={[AXIS_THICKNESS, AXIS_THICKNESS, AXIS_LENGTH]} />
        <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}
