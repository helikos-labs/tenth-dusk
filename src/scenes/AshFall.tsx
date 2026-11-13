// Falling ash (ART-DIRECTION §3.6): the flakes of world/ashfall.ts in the scene. Its uniforms are the scene's (uTime and
// uFocus advance in WorldScene's one frame callback), so it adds no per-frame work and never asks for a frame: on
// phones the flakes move only when a frame is drawn anyway. `ref` hands the Points to the scene's warm-up.
// oxlint-disable react/immutability -- the material's pixel-ratio uniform changes in place.
import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, type Ref } from 'react'
import type * as THREE from 'three'
import { makeAshFall, type AshUniforms } from '../world/ashfall.ts'

export default function AshFall({ uniforms, ref }: { uniforms: AshUniforms; ref?: Ref<THREE.Points> }) {
  const dpr = useThree((st) => st.viewport.dpr)
  const points = useMemo(() => makeAshFall(uniforms), [uniforms])
  useLayoutEffect(() => {
    ;(points.material as THREE.ShaderMaterial).uniforms.uPx.value = dpr
  }, [points, dpr])
  useEffect(
    () => () => {
      points.geometry.dispose()
      ;(points.material as THREE.Material).dispose()
    },
    [points],
  )
  return <primitive object={points} ref={ref} dispose={null} />
}
