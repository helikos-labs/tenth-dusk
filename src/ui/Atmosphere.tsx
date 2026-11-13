// The vignette and grain (ART-DIRECTION §3.8): one fixed, static layer over the world's canvas and under the HUD,
// composited by the browser (the GPU never redraws the world for it), and never in the way of a tap.
export default function Atmosphere() {
  return <div className="td-atmos" aria-hidden="true" />
}
