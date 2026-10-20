// THE FLYOVER's world (2026-10-15): the three.js half of /live?view=flyover.
// lib/flyover holds every rule (the ledger, the ladders, the layout); this
// module only draws what it is handed, and is loaded ONLY by
// components/live/Flyover.tsx through `import('./flyover-scene')` after mount,
// so the server bundle and the other four /live views never carry three.
//
// What is drawn, and the budget it keeps (≤ 8 draw calls plus sprites, no
// allocation in the frame loop, no post-processing):
//   • the plots — ONE InstancedMesh of boxes. Every plot is a column from the
//     seabed up to its top: a riser stands above the sea, a sinker's top sits
//     below it (a pit) and the translucent sea plane tints it. Heights spring
//     toward their target (critically damped, ~0.35 s); a relayout tweens the
//     footprints over 900 ms; a new plot rises out of the sea, a dropped one
//     sinks into it.
//   • the drops — ONE InstancedMesh pool of 2,000: every fill falls onto its
//     plot in ~700 ms, flashes and dies; a print of $50K+ is a meteor (a
//     bigger head with a trail, a ring on the plot, a transient tag).
//   • the sea (a translucent sheen over the depths, which are the clear color
//     and the fog; bare ground in the Activity lens), the chart (a faint grid
//     and every coastline, one line batch), the continents' names, flags on
//     the top three risers and sinkers, beacons on the pick, an outline on the
//     pinned plot, and the plot labels (constant-size sprites, decluttered in
//     screen space every few frames, never under the HUD's panels).
// Inks arrive as hex from the page's tokens probe (components/markets/chart/
// chart-tokens readTokens) — three's Color cannot read color-mix() or oklch().

import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  LineSegments,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MAX_STORIES, type ContinentId, type WorldLayout } from '@/lib/flyover'

// ── The look ─────────────────────────────────────────────────────────────────

/** Every ink the world wears, as #rrggbb from the page's tokens. */
export interface SceneInks {
  bg: string
  fg: string
  muted: string
  line: string
  surf: string
  accent: string
  up: string
  down: string
  /** The sea's tint (the markets' first series ink, a blue). */
  water: string
  /** Light or dark ground: a few mixes differ. */
  light: boolean
}

export interface SceneOpts {
  inks: SceneInks
  reducedMotion: boolean
  /** Device pixels per CSS pixel, already capped by the caller. */
  dpr: number
  /** CSS font stacks for the labels. */
  fontMono: string
  fontUi: string
}

export interface SceneLabel {
  key: string
  title: string
  /** The second line (a signed figure). */
  sub: string | null
  tone: 'up' | 'down' | 'flat'
  /** Higher wins a crowded spot; pinned and hovered labels always show. */
  priority: number
  forced?: boolean
}

export interface ContinentLabel {
  id: ContinentId
  title: string
  sub: string
}

export interface FlyoverScene {
  setWorld(layout: WorldLayout): void
  /** Target heights in stories, by plot key (a missing key stands at sea level). */
  setHeights(stories: ReadonlyMap<string, number>): void
  /** Color positions −1 … 1 (lib/flyover moveT), by plot key. */
  setColors(t: ReadonlyMap<string, number>): void
  setLabels(labels: readonly SceneLabel[]): void
  setContinentLabels(labels: readonly ContinentLabel[]): void
  /** The Flow and Move lenses draw a sea; Activity bare ground. */
  setSea(on: boolean): void
  /** Pixels the HUD covers on the right and the bottom of the canvas: the
   *  world is centred (and fitted) in the space that is left. */
  setInsets(right: number, bottom: number): void
  /** Canvas-pixel rects a HUD panel covers: no label is placed under one. */
  setExclusions(rects: readonly { x0: number; y0: number; x1: number; y1: number }[]): void
  drop(key: string, side: 'buy' | 'sell', usd: number): void
  meteor(key: string, side: 'buy' | 'sell', usd: number, tag: string): void
  setPick(keys: readonly string[]): void
  /** Flags: the top three risers (+1) and sinkers (−1). */
  setFlags(flags: readonly { key: string; dir: 1 | -1 }[]): void
  setHover(key: string | null): void
  setPinned(key: string | null): void
  flyTo(key: string): void
  flyToContinent(id: ContinentId): void
  fitAll(): void
  tour(on: boolean): void
  touring(): boolean
  /** Keyboard flying: pan along the ground (camera-relative), climb or descend. */
  nudge(right: number, forward: number): void
  climb(dir: number): void
  resize(): void
  setInks(inks: SceneInks): void
  setReducedMotion(on: boolean): void
  /** The plot under a client point, or null. */
  pick(clientX: number, clientY: number): string | null
  /** Called on any hand on the camera (drag, wheel, touch, keys). */
  onInteract(cb: () => void): void
  /** Live counters for the drive: plots drawn, drops alive, frames. */
  stats(): { plots: number; drops: number; frames: number; labels: number; camera: string }
  dispose(): void
}

// ── Constants ────────────────────────────────────────────────────────────────

/** World units per story. */
const STORY = 9
const SEABED = -(MAX_STORIES + 0.8) * STORY
const SEA_Y = -0.06
const SLOT_CAP = 232
const DROP_POOL = 2000
const METEOR_POOL = 10
const RECT_TWEEN_MS = 900
const DIE_MS = 1100
/** Critically damped spring: ω for a ~0.35 s settle. */
const OMEGA = 11
const DROP_FALL_MS = 700
const DROP_FLASH_MS = 180
const DROP_FALL_H = 34
const METEOR_FALL_MS = 950
const METEOR_FALL_H = 78
const RING_MS = 1500
const TAG_MS = 2600
const FLYTO_MS = 1200
const LABEL_EVERY = 3
const BEACON_H = 46
const FLAG_H = 15

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

// ── The scene ────────────────────────────────────────────────────────────────

export function createFlyoverScene(canvas: HTMLCanvasElement, opts: SceneOpts): FlyoverScene {
  let inks = opts.inks
  let reduced = opts.reducedMotion
  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false })
  renderer.setPixelRatio(opts.dpr)
  renderer.outputColorSpace = SRGBColorSpace

  const scene = new Scene()
  const camera = new PerspectiveCamera(40, 1, 0.5, 8000)
  camera.position.set(0, 300, 400)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.screenSpacePanning = false
  controls.maxPolarAngle = Math.PI / 2 - 0.16
  controls.minPolarAngle = 0.08
  controls.minDistance = 8
  controls.maxDistance = 2400
  controls.rotateSpeed = 0.6
  controls.zoomSpeed = 0.9
  controls.panSpeed = 0.9

  const hemi = new HemisphereLight(0xffffff, 0x101010, 1.15)
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(-0.55, 1, 0.42)
  scene.add(hemi, sun)
  scene.fog = new Fog(0x000000, 600, 2600)

  // Scratch objects: the frame loop allocates nothing.
  const M = new Matrix4()
  const V = new Vector3()
  const V2 = new Vector3()
  const V3 = new Vector3()
  const SAVED_T = new Vector3()
  const C = new Color()
  const C2 = new Color()
  const NDC = new Vector2()
  const BOX = new Box3()
  const HIT = new Vector3()
  const ray = new Raycaster()
  const ZERO = new Matrix4().makeScale(0, 0, 0)

  // ── The ground ─────────────────────────────────────────────────────────
  const planeGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  // The depths are the clear color (and the fog): no seabed to draw. The sea
  // is a translucent sheen over them; in the Activity lens an opaque floor.
  const deepC = new Color()
  const floorC = new Color()
  const seaMat = new MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false })
  const sea = new Mesh(planeGeo, seaMat)
  sea.position.y = SEA_Y
  sea.renderOrder = 1
  // The chart: a faint grid over the water and every continent's coastline,
  // ONE line batch with per-vertex ink.
  const linesMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })
  const lines = new LineSegments(new BufferGeometry(), linesMat)
  lines.position.y = SEA_Y + 0.04
  lines.renderOrder = 2
  let gridPts: number[] = []
  let coastPts: number[] = []
  const gridInk = new Color()
  const coastInk = new Color()
  scene.add(sea, lines)
  let seaOn = true

  // ── The plots ──────────────────────────────────────────────────────────
  const boxGeo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const plotMat = new MeshStandardMaterial({ roughness: 0.62, metalness: 0.05 })
  // A little self-light in the plot's own color (its move): the land reads on
  // a dark ground without a bloom pass. Set per theme in applyInks.
  const selfLight = { value: 0.2 }
  // Under the sea, the water takes over: a fragment below sea level mixes
  // toward the water's ink by its depth, so a sinker's top reads as sunk (its
  // red still showing a story down, gone by four) and every column's sides
  // fade into the sea instead of standing like a building.
  const waterInk = { value: new Color(0x0a1a30) }
  const seaY = { value: SEA_Y }
  plotMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSelfLight = selfLight
    shader.uniforms.uWater = waterInk
    shader.uniforms.uSeaY = seaY
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying float vFyY;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n\tvec4 fyW = vec4( transformed, 1.0 );\n\t#ifdef USE_INSTANCING\n\tfyW = instanceMatrix * fyW;\n\t#endif\n\tvFyY = ( modelMatrix * fyW ).y;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uSelfLight;\nuniform vec3 uWater;\nuniform float uSeaY;\nvarying float vFyY;\nvoid main() {`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * uSelfLight;')
      .replace('#include <opaque_fragment>', `\tif ( vFyY < uSeaY ) outgoingLight = mix( outgoingLight, uWater, clamp( ( uSeaY - vFyY ) / ${(STORY * 4).toFixed(1)}, 0.0, 0.9 ) );\n#include <opaque_fragment>`)
  }
  const plots = new InstancedMesh(boxGeo, plotMat, SLOT_CAP)
  plots.instanceMatrix.setUsage(DynamicDrawUsage)
  plots.frustumCulled = false
  for (let i = 0; i < SLOT_CAP; i++) {
    plots.setMatrixAt(i, ZERO)
    plots.setColorAt(i, C.set(0x777777))
  }
  plots.count = 0
  scene.add(plots)

  const slotKey: (string | null)[] = new Array(SLOT_CAP).fill(null)
  const slotOf = new Map<string, number>()
  /** 0 free · 1 live · 2 dying */
  const state = new Uint8Array(SLOT_CAP)
  const rFrom = new Float32Array(SLOT_CAP * 4)
  const rTo = new Float32Array(SLOT_CAP * 4)
  const rT0 = new Float64Array(SLOT_CAP)
  const rNow = new Float32Array(SLOT_CAP * 4)
  const hCur = new Float32Array(SLOT_CAP)
  const hVel = new Float32Array(SLOT_CAP)
  const hTgt = new Float32Array(SLOT_CAP)
  const tCur = new Float32Array(SLOT_CAP)
  const tTgt = new Float32Array(SLOT_CAP)
  const flash = new Float32Array(SLOT_CAP)
  const flashUp = new Uint8Array(SLOT_CAP)
  const dieAt = new Float64Array(SLOT_CAP)
  let highSlot = 0
  let hoverSlot = -1
  let pinnedSlot = -1

  const neutral = new Color()
  const upC = new Color()
  const downC = new Color()
  const fgC = new Color()
  const seabedC = new Color()

  // ── Overlays: outline, beacons, flags ──────────────────────────────────
  const squareGeo = new BufferGeometry()
  squareGeo.setAttribute('position', new Float32BufferAttribute([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, -0.5], 3))
  const outlineMat = new LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false })
  const outline = new Line(squareGeo, outlineMat)
  outline.visible = false
  outline.renderOrder = 8
  scene.add(outline)

  const beaconGeo = new CylinderGeometry(0.5, 0.5, 1, 18, 1, true).translate(0, 0.5, 0)
  const beaconMat = new MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide })
  const beacons = new InstancedMesh(beaconGeo, beaconMat, 12)
  beacons.count = 0
  beacons.frustumCulled = false
  beacons.renderOrder = 4
  scene.add(beacons)
  let pickKeys: string[] = []

  const poleGeo = new CylinderGeometry(0.18, 0.18, 1, 6).translate(0, 0.5, 0)
  const poleMat = new MeshStandardMaterial({ roughness: 0.5 })
  const poles = new InstancedMesh(poleGeo, poleMat, 6)
  poles.count = 0
  poles.frustumCulled = false
  const pennantGeo = new BufferGeometry()
  pennantGeo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 4.6, -1.3, 0, 0, -2.6, 0], 3))
  pennantGeo.computeVertexNormals()
  const pennantMat = new MeshBasicMaterial({ side: DoubleSide })
  const pennants = new InstancedMesh(pennantGeo, pennantMat, 6)
  pennants.count = 0
  pennants.frustumCulled = false
  for (let i = 0; i < 6; i++) pennants.setColorAt(i, C.set(0xffffff))
  scene.add(poles, pennants)
  let flagList: { key: string; dir: 1 | -1 }[] = []

  // ── Drops ──────────────────────────────────────────────────────────────
  const dropGeo = new OctahedronGeometry(0.5, 0)
  const dropMat = new MeshBasicMaterial({ fog: true })
  const drops = new InstancedMesh(dropGeo, dropMat, DROP_POOL)
  drops.instanceMatrix.setUsage(DynamicDrawUsage)
  drops.frustumCulled = false
  for (let i = 0; i < DROP_POOL; i++) {
    drops.setMatrixAt(i, ZERO)
    drops.setColorAt(i, C.set(0xffffff))
  }
  drops.renderOrder = 3
  scene.add(drops)
  const dSlot = new Int16Array(DROP_POOL).fill(-1)
  const dX = new Float32Array(DROP_POOL)
  const dZ = new Float32Array(DROP_POOL)
  const dT0 = new Float64Array(DROP_POOL)
  const dSize = new Float32Array(DROP_POOL)
  const dAlive = new Uint8Array(DROP_POOL)
  let dHead = 0
  let dropsAlive = 0

  // ── Meteors ────────────────────────────────────────────────────────────
  const headGeo = new SphereGeometry(1, 18, 12)
  const trailGeo = new ConeGeometry(1, 1, 14, 1, true).translate(0, 0.5, 0)
  const ringGeo = new RingGeometry(0.86, 1, 72).rotateX(-Math.PI / 2)
  interface Meteor {
    head: Mesh<SphereGeometry, MeshBasicMaterial>
    trail: Mesh<ConeGeometry, MeshBasicMaterial>
    ring: Mesh<RingGeometry, MeshBasicMaterial>
    tag: Sprite
    tagCanvas: HTMLCanvasElement
    tagTex: CanvasTexture
    tagW: number
    tagH: number
    alive: boolean
    slot: number
    x: number
    z: number
    t0: number
    size: number
    reach: number
  }
  const meteors: Meteor[] = []
  for (let i = 0; i < METEOR_POOL; i++) {
    const head = new Mesh(headGeo, new MeshBasicMaterial())
    const trail = new Mesh(trailGeo, new MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }))
    const ring = new Mesh(ringGeo, new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }))
    const tagCanvas = document.createElement('canvas')
    tagCanvas.width = 8
    tagCanvas.height = 8
    const tagTex = new CanvasTexture(tagCanvas)
    tagTex.colorSpace = SRGBColorSpace
    tagTex.minFilter = LinearFilter
    tagTex.generateMipmaps = false
    const tag = new Sprite(new SpriteMaterial({ map: tagTex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, fog: false }))
    tag.center.set(0.5, 0)
    tag.renderOrder = 11
    for (const o of [head, trail, ring, tag]) {
      o.visible = false
      scene.add(o)
    }
    trail.renderOrder = 5
    ring.renderOrder = 5
    meteors.push({ head, trail, ring, tag, tagCanvas, tagTex, tagW: 8, tagH: 8, alive: false, slot: -1, x: 0, z: 0, t0: 0, size: 1, reach: 4 })
  }

  // ── Labels ─────────────────────────────────────────────────────────────
  interface LabelEntry {
    sprite: Sprite
    canvas: HTMLCanvasElement
    tex: CanvasTexture
    text: string
    /** The plate's width (what clashes) and the canvas's (what is drawn), CSS px. */
    wPx: number
    cw: number
    hPx: number
    priority: number
    forced: boolean
    shown: boolean
    def: SceneLabel
  }
  const labels = new Map<string, LabelEntry>()
  let labelOrder: LabelEntry[] = []
  let labelKeysOrder: string[] = []

  interface GroundLabel {
    sprite: Sprite
    canvas: HTMLCanvasElement
    tex: CanvasTexture
    text: string
    wPx: number
    cw: number
    hPx: number
  }
  const ground = new Map<ContinentId, GroundLabel>()
  /** The same labels as an array (iterating a Map allocates an entry per step). */
  let groundList: { id: ContinentId; g: GroundLabel }[] = []
  /** Each continent's rect by id, set with the world. */
  const contRect = new Map<ContinentId, { x: number; z: number; w: number; d: number }>()
  /** The screen boxes the label pass has placed (x0, y0, x1, y1 …), reused. */
  const BOXES = new Float32Array(4 * 512)
  /** Scratch for the camera's spherical position (the frame loop allocates nothing). */
  const SPH = { r: 0, polar: 0, az: 0 }
  /** The HUD's panels in canvas px (x0, y0, x1, y1 …). */
  let EXCL = new Float32Array(0)
  let insetR = 0
  let insetB = 0

  // ── World bounds and camera ────────────────────────────────────────────
  let layout: WorldLayout = { continents: [], plots: [], width: 0, depth: 0 }
  let worldW = 200
  let worldD = 120
  let fitted = false
  const tween = { on: false, t0: 0, from: new Vector3(), to: new Vector3(), r0: 0, r1: 0, p0: 0, p1: 0, a0: 0, a1: 0 }
  let touringOn = false
  /** The radius the tour's orbit eases toward (0: keep its own). */
  let tourR = 0
  let tourBasePolar = 0.95
  let tourClock = 0
  let interactCb: (() => void) | null = null
  let frames = 0
  let W = 1
  let H = 1
  let labelScale = 0.001

  const userInput = () => {
    tween.on = false
    touringOn = false
    interactCb?.()
  }
  controls.addEventListener('start', userInput)

  // ── Inks ───────────────────────────────────────────────────────────────
  function applyInks(): void {
    const bg = new Color(inks.bg)
    const water = new Color(inks.water)
    deepC.copy(bg).lerp(water, inks.light ? 0.3 : 0.035)
    floorC.copy(bg).lerp(new Color(inks.fg), inks.light ? 0.12 : 0.06)
    renderer.setClearColor(deepC, 1)
    ;(scene.fog as Fog).color.copy(deepC)
    fgC.set(inks.fg)
    upC.set(inks.up)
    downC.set(inks.down)
    neutral.set(inks.surf).lerp(fgC, inks.light ? 0.26 : 0.24)
    hemi.color.set(0xffffff)
    hemi.groundColor.copy(bg).lerp(fgC, 0.15)
    selfLight.value = inks.light ? 0.06 : 0.22
    hemi.intensity = inks.light ? 1.35 : 1.05
    sun.intensity = inks.light ? 1.15 : 1.7
    seabedC.copy(deepC)
    // Depth reads as the water's own ink: a navy on dark ground, a chart-blue on paper.
    if (inks.light) waterInk.value.copy(bg).lerp(water, 0.5)
    else waterInk.value.copy(deepC)
    gridInk.copy(deepC).lerp(fgC, inks.light ? 0.16 : 0.07)
    coastInk.copy(deepC).lerp(fgC, inks.light ? 0.45 : 0.3)
    paintLines()
    outlineMat.color.copy(fgC)
    beaconMat.color.set(inks.accent)
    poleMat.color.copy(fgC).lerp(bg, 0.25)
    for (const m of meteors) {
      // Recolored at spawn; nothing to keep here.
      m.ring.material.color.copy(fgC)
    }
    for (const e of labels.values()) drawLabel(e)
    for (const g of ground.values()) drawGround(g, g.text)
    applySeaMode()
  }

  function applySeaMode(): void {
    if (seaOn) {
      seaMat.transparent = true
      seaMat.opacity = inks.light ? 0.3 : 0.38
      seaMat.color.copy(deepC).lerp(C.set(inks.water), inks.light ? 0.25 : 0.12)
      seaMat.depthWrite = false
    } else {
      // Bare ground: opaque, a floor ink — the Activity lens has no sea.
      seaMat.transparent = false
      seaMat.opacity = 1
      seaMat.color.copy(floorC)
      seaMat.depthWrite = true
    }
    seaMat.needsUpdate = true
  }

  /** The grid and the coasts as one batch, each vertex in its own ink. */
  function paintLines(): void {
    const n = (gridPts.length + coastPts.length) / 3
    const col = new Float32Array(n * 3)
    for (let i = 0; i < gridPts.length / 3; i++) col.set([gridInk.r, gridInk.g, gridInk.b], i * 3)
    for (let i = gridPts.length / 3; i < n; i++) col.set([coastInk.r, coastInk.g, coastInk.b], i * 3)
    lines.geometry.dispose()
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([...gridPts, ...coastPts], 3))
    g.setAttribute('color', new Float32BufferAttribute(col, 3))
    lines.geometry = g
  }

  // ── Canvas text ────────────────────────────────────────────────────────
  const LABEL_PX = 2 // the canvas draws at twice the CSS size

  function drawLabel(e: LabelEntry): void {
    const d = e.def
    const c = e.canvas
    const ctx = c.getContext('2d')
    if (!ctx) return
    const titleFont = `600 ${12 * LABEL_PX}px ${opts.fontUi}`
    const subFont = `500 ${10.5 * LABEL_PX}px ${opts.fontMono}`
    ctx.font = titleFont
    const tw = ctx.measureText(d.title).width
    ctx.font = subFont
    const sw = d.sub ? ctx.measureText(d.sub).width : 0
    const padX = 7 * LABEL_PX
    const pw = Math.ceil(Math.max(tw, sw) + padX * 2)
    const h = Math.ceil((d.sub ? 34 : 21) * LABEL_PX)
    // The canvas grows in steps, so a figure that changes width every second
    // reuses its texture (WebGL2 storage is fixed once allocated); the plate
    // is drawn centred in it.
    const w = Math.ceil(pw / 48) * 48
    if (c.width !== w || c.height !== h) {
      c.width = w
      c.height = h
      e.tex = renewTexture(e.tex, c, e.sprite.material)
    }
    ctx.clearRect(0, 0, w, h)
    const x0 = (w - pw) / 2
    const r = 6 * LABEL_PX
    const tone = d.tone === 'up' ? inks.up : d.tone === 'down' ? inks.down : inks.line
    ctx.globalAlpha = 0.9
    ctx.fillStyle = inks.surf
    roundRect(ctx, x0 + 1, 1, pw - 2, h - 2, r)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.lineWidth = 1.5 * LABEL_PX
    ctx.strokeStyle = tone
    roundRect(ctx, x0 + 1, 1, pw - 2, h - 2, r)
    ctx.stroke()
    ctx.textBaseline = 'alphabetic'
    ctx.font = titleFont
    ctx.fillStyle = inks.fg
    ctx.fillText(d.title, x0 + padX, 15 * LABEL_PX)
    if (d.sub) {
      ctx.font = subFont
      ctx.fillStyle = d.tone === 'flat' ? inks.muted : tone
      ctx.fillText(d.sub, x0 + padX, 28 * LABEL_PX)
    }
    e.cw = w / LABEL_PX
    e.wPx = pw / LABEL_PX
    e.hPx = h / LABEL_PX
    e.tex.needsUpdate = true
  }

  function drawGround(g: GroundLabel, text: string): void {
    const ctx = g.canvas.getContext('2d')
    if (!ctx) return
    const [title, sub] = text.split('\n')
    const S = LABEL_PX
    const titleFont = `700 ${10 * S}px ${opts.fontUi}`
    const subFont = `500 ${9.5 * S}px ${opts.fontMono}`
    const upper = title.toUpperCase()
    ctx.font = titleFont
    const tw = ctx.measureText(upper).width + upper.length * 1.2 * S
    ctx.font = subFont
    const sw = sub ? ctx.measureText(sub).width : 0
    const pad = 6 * S
    const pw = Math.ceil(Math.max(tw, sw) + pad * 2)
    const w = Math.ceil(pw / 64) * 64
    const h = Math.ceil(32 * S)
    if (g.canvas.width !== w || g.canvas.height !== h) {
      g.canvas.width = w
      g.canvas.height = h
      g.tex = renewTexture(g.tex, g.canvas, g.sprite.material)
    }
    ctx.clearRect(0, 0, w, h)
    // A quiet plate so the name reads over land, sea or a tower (left-aligned: the sprite hangs from its left edge).
    ctx.globalAlpha = inks.light ? 0.82 : 0.72
    ctx.fillStyle = inks.bg
    roundRect(ctx, 0, 0, pw, h, 6 * S)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.textBaseline = 'alphabetic'
    ctx.font = titleFont
    ctx.fillStyle = inks.fg
    let x = pad
    for (const ch of upper) {
      ctx.fillText(ch, x, 13 * S)
      x += ctx.measureText(ch).width + 1.2 * S
    }
    if (sub) {
      ctx.font = subFont
      ctx.fillStyle = inks.muted
      ctx.fillText(sub, pad, 26 * S)
    }
    g.wPx = pw / S
    g.cw = w / S
    g.hPx = h / S
    g.text = text
    g.tex.needsUpdate = true
  }

  /** A canvas that changed size needs a new texture: WebGL2 texture storage
   *  is allocated once (three uses texStorage2D), so re-uploading a resized
   *  canvas into the old one draws stale or torn text. */
  function renewTexture(old: CanvasTexture, canvas: HTMLCanvasElement, mat: SpriteMaterial): CanvasTexture {
    old.dispose()
    const t = makeTexture(canvas)
    mat.map = t
    mat.needsUpdate = true
    return t
  }

  function makeTexture(canvas: HTMLCanvasElement): CanvasTexture {
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    t.minFilter = LinearFilter
    t.magFilter = LinearFilter
    t.generateMipmaps = false
    return t
  }

  // ── The world ──────────────────────────────────────────────────────────
  function rectOf(slot: number, out: Float32Array, o: number): void {
    out[o] = rNow[slot * 4]
    out[o + 1] = rNow[slot * 4 + 1]
    out[o + 2] = rNow[slot * 4 + 2]
    out[o + 3] = rNow[slot * 4 + 3]
  }

  function freeSlot(): number {
    for (let i = 0; i < SLOT_CAP; i++) if (state[i] === 0) return i
    return -1
  }

  function setWorld(next: WorldLayout): void {
    const now = performance.now()
    layout = next
    worldW = Math.max(60, next.width)
    worldD = Math.max(60, next.depth)
    const want = new Set(next.plots.map((p) => p.key))
    // Dropped plots sink.
    for (const [key, slot] of slotOf) {
      if (want.has(key)) continue
      slotOf.delete(key)
      state[slot] = 2
      dieAt[slot] = now
      hTgt[slot] = SEABED
      if (hoverSlot === slot) hoverSlot = -1
      if (pinnedSlot === slot) pinnedSlot = -1
    }
    for (const p of next.plots) {
      let slot = slotOf.get(p.key)
      const r = p.rect
      if (slot === undefined) {
        slot = freeSlot()
        if (slot < 0) continue
        slotOf.set(p.key, slot)
        slotKey[slot] = p.key
        state[slot] = 1
        // A new plot rises out of the sea, on its final footprint.
        rFrom.set([r.x, r.z, r.w, r.d], slot * 4)
        rTo.set([r.x, r.z, r.w, r.d], slot * 4)
        rNow.set([r.x, r.z, r.w, r.d], slot * 4)
        rT0[slot] = now - RECT_TWEEN_MS
        hCur[slot] = reduced ? 0 : SEABED + 0.5
        hVel[slot] = 0
        hTgt[slot] = 0
        tCur[slot] = 0
        tTgt[slot] = 0
        flash[slot] = 0
        highSlot = Math.max(highSlot, slot + 1)
      } else {
        state[slot] = 1
        rectOf(slot, rFrom, slot * 4)
        rTo.set([r.x, r.z, r.w, r.d], slot * 4)
        rT0[slot] = reduced ? now - RECT_TWEEN_MS : now
      }
    }
    plots.count = highSlot
    contRect.clear()
    for (const c of next.continents) contRect.set(c.id, c.rect)
    // The sea and the chart.
    const span = Math.max(worldW, worldD) * 7
    sea.scale.set(span, 1, span)
    buildGrid()
    coastPts = []
    for (const c of next.continents) {
      const x0 = c.rect.x - 0.6
      const z0 = c.rect.z - 0.6
      const x1 = c.rect.x + c.rect.w + 0.6
      const z1 = c.rect.z + c.rect.d + 0.6
      coastPts.push(x0, 0, z0, x1, 0, z0, x1, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z1, x0, 0, z1, x0, 0, z0)
    }
    paintLines()
    updateFog()
    if (!fitted && next.plots.length) {
      fitted = true
      fitAll(true)
    } else reframe(false)
  }

  function buildGrid(): void {
    const step = 10
    const halfW = Math.ceil((worldW * 1.6) / 2 / step) * step
    const halfD = Math.ceil((worldD * 2.2) / 2 / step) * step
    const pts: number[] = []
    for (let x = -halfW; x <= halfW; x += step) pts.push(x, 0, -halfD, x, 0, halfD)
    for (let z = -halfD; z <= halfD; z += step) pts.push(-halfW, 0, z, halfW, 0, z)
    gridPts = pts
  }

  function updateFog(): void {
    const r = camera.position.distanceTo(controls.target)
    const f = scene.fog as Fog
    const span = Math.max(worldW, worldD)
    f.near = r + span * 0.6
    f.far = f.near + r * 2.2 + span
  }

  function setHeights(stories: ReadonlyMap<string, number>): void {
    for (const [key, slot] of slotOf) {
      const s = stories.get(key) ?? 0
      hTgt[slot] = Math.max(-MAX_STORIES, Math.min(MAX_STORIES, s)) * STORY
    }
  }

  function setColors(t: ReadonlyMap<string, number>): void {
    for (const [key, slot] of slotOf) tTgt[slot] = Math.max(-1, Math.min(1, t.get(key) ?? 0))
  }

  // ── Labels ─────────────────────────────────────────────────────────────
  function setLabels(list: readonly SceneLabel[]): void {
    const keep = new Set<string>()
    for (const d of list) {
      if (!slotOf.has(d.key)) continue
      keep.add(d.key)
      const text = `${d.title}\n${d.sub ?? ''}\n${d.tone}`
      let e = labels.get(d.key)
      if (!e) {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const tex = makeTexture(canvas)
        const sprite = new Sprite(new SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, fog: false }))
        sprite.center.set(0.5, 0)
        sprite.renderOrder = 10
        sprite.visible = false
        scene.add(sprite)
        e = { sprite, canvas, tex, text: '', wPx: 0, cw: 0, hPx: 0, priority: 0, forced: false, shown: false, def: d }
        labels.set(d.key, e)
      }
      e.priority = d.priority
      e.forced = !!d.forced
      e.def = d
      if (e.text !== text) {
        e.text = text
        drawLabel(e)
      }
    }
    for (const [key, e] of labels) {
      if (keep.has(key)) continue
      scene.remove(e.sprite)
      e.sprite.material.dispose()
      e.tex.dispose()
      labels.delete(key)
    }
    labelOrder = [...labels.values()].sort((a, b) => Number(b.forced) - Number(a.forced) || b.priority - a.priority)
    labelKeysOrder = labelOrder.map((e) => e.def.key)
  }

  function setContinentLabels(list: readonly ContinentLabel[]): void {
    const keep = new Set<ContinentId>()
    for (const l of list) {
      keep.add(l.id)
      const text = `${l.title}\n${l.sub}`
      let g = ground.get(l.id)
      if (!g) {
        const canvas = document.createElement('canvas')
        canvas.width = 8
        canvas.height = 8
        const tex = makeTexture(canvas)
        const sprite = new Sprite(new SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, depthWrite: false, transparent: true, fog: false }))
        sprite.center.set(0, 1)
        sprite.renderOrder = 9
        sprite.visible = false
        scene.add(sprite)
        g = { sprite, canvas, tex, text: '', wPx: 0, cw: 0, hPx: 0 }
        ground.set(l.id, g)
      }
      if (g.text !== text) drawGround(g, text)
    }
    for (const [id, g] of ground) {
      if (keep.has(id)) continue
      scene.remove(g.sprite)
      g.sprite.material.dispose()
      g.tex.dispose()
      ground.delete(id)
    }
    groundList = [...ground.entries()].map(([id, g]) => ({ id, g }))
  }

  function underHud(x0: number, y0: number, x1: number, y1: number): boolean {
    for (let i = 0; i < EXCL.length; i += 4) if (x0 < EXCL[i + 2] && x1 > EXCL[i] && y0 < EXCL[i + 3] && y1 > EXCL[i + 1]) return true
    return false
  }

  function placeLabels(): void {
    const P11 = camera.projectionMatrix.elements[5]
    labelScale = 2 / (P11 * H)
    let nb = 0
    // The continents' names first: few, and they hold their spot. Anchored at
    // the continent's front-left shore.
    for (let gi = 0; gi < groundList.length; gi++) {
      const g = groundList[gi].g
      const c = contRect.get(groundList[gi].id)
      if (!c) {
        g.sprite.visible = false
        continue
      }
      V.set(c.x, SEA_Y + 0.2, c.z + c.d + 1.5)
      g.sprite.position.copy(V)
      V.project(camera)
      if (V.z > 1 || V.x < -1.3 || V.x > 1.05 || V.y < -1.2 || V.y > 1.1) {
        g.sprite.visible = false
        continue
      }
      const px = (V.x * 0.5 + 0.5) * W
      const py = (-V.y * 0.5 + 0.5) * H
      let clash = underHud(px, py, px + g.wPx, py + g.hPx)
      for (let i = 0; i < nb && !clash; i += 4) {
        if (px - 2 < BOXES[i + 2] && px + g.wPx + 2 > BOXES[i] && py - 2 < BOXES[i + 3] && py + g.hPx + 2 > BOXES[i + 1]) {
          clash = true
          break
        }
      }
      g.sprite.visible = !clash
      if (clash) continue
      g.sprite.scale.set(g.cw * labelScale, g.hPx * labelScale, 1)
      if (nb + 4 <= BOXES.length) {
        BOXES[nb] = px - 2
        BOXES[nb + 1] = py - 2
        BOXES[nb + 2] = px + g.wPx + 2
        BOXES[nb + 3] = py + g.hPx + 2
        nb += 4
      }
    }
    for (const e of labelOrder) {
      const slot = slotOf.get(e.def.key)
      if (slot === undefined || state[slot] !== 1) {
        e.sprite.visible = false
        continue
      }
      const o = slot * 4
      const top = Math.max(hCur[slot], SEA_Y) + 0.8
      V.set(rNow[o] + rNow[o + 2] / 2, top, rNow[o + 1] + rNow[o + 3] / 2)
      e.sprite.position.copy(V)
      V.project(camera)
      if (V.z > 1 || V.x < -1.15 || V.x > 1.15 || V.y < -1.1 || V.y > 1.25) {
        e.sprite.visible = false
        continue
      }
      const px = (V.x * 0.5 + 0.5) * W
      const py = (-V.y * 0.5 + 0.5) * H
      const x0 = px - e.wPx / 2 - 2
      const x1 = px + e.wPx / 2 + 2
      const y0 = py - e.hPx - 2
      const y1 = py + 2
      let clash = underHud(x0, y0, x1, y1)
      if (!clash && !e.forced) {
        for (let i = 0; i < nb; i += 4) {
          if (x0 < BOXES[i + 2] && x1 > BOXES[i] && y0 < BOXES[i + 3] && y1 > BOXES[i + 1]) {
            clash = true
            break
          }
        }
      }
      if (clash) {
        e.sprite.visible = false
        continue
      }
      if (nb + 4 <= BOXES.length) {
        BOXES[nb] = x0
        BOXES[nb + 1] = y0
        BOXES[nb + 2] = x1
        BOXES[nb + 3] = y1
        nb += 4
      }
      e.sprite.visible = true
      e.sprite.scale.set(e.cw * labelScale, e.hPx * labelScale, 1)
    }
  }

  // ── Pick, flags, hover, pin ────────────────────────────────────────────
  function setPick(keys: readonly string[]): void {
    pickKeys = [...keys]
    beacons.count = 0
  }
  function setFlags(list: readonly { key: string; dir: 1 | -1 }[]): void {
    flagList = list.slice(0, 6)
    flagList.forEach((f, i) => pennants.setColorAt(i, C.set(f.dir > 0 ? inks.up : inks.down)))
    if (pennants.instanceColor) pennants.instanceColor.needsUpdate = true
  }
  function setHover(key: string | null): void {
    hoverSlot = key ? (slotOf.get(key) ?? -1) : -1
  }
  function setPinned(key: string | null): void {
    pinnedSlot = key ? (slotOf.get(key) ?? -1) : -1
  }

  // ── Drops and meteors ──────────────────────────────────────────────────
  function drop(key: string, side: 'buy' | 'sell', usd: number): void {
    if (reduced) return
    const slot = slotOf.get(key)
    if (slot === undefined || state[slot] !== 1) return
    const i = dHead
    dHead = (dHead + 1) % DROP_POOL
    if (!dAlive[i]) dropsAlive++
    const o = slot * 4
    const w = rNow[o + 2]
    const d = rNow[o + 3]
    dSlot[i] = slot
    dX[i] = rNow[o] + w * (0.18 + Math.random() * 0.64)
    dZ[i] = rNow[o + 1] + d * (0.18 + Math.random() * 0.64)
    dT0[i] = performance.now()
    dSize[i] = Math.min(3, 0.7 + Math.sqrt(Math.max(0, usd)) / 110)
    dAlive[i] = 1
    drops.setColorAt(i, C.set(side === 'buy' ? inks.up : inks.down))
    if (drops.instanceColor) drops.instanceColor.needsUpdate = true
    flash[slot] = Math.min(1, flash[slot] + 0.12 + Math.min(0.5, usd / 100_000))
    flashUp[slot] = side === 'buy' ? 1 : 0
  }

  function meteor(key: string, side: 'buy' | 'sell', usd: number, tagText: string): void {
    if (reduced) return
    const slot = slotOf.get(key)
    if (slot === undefined || state[slot] !== 1) return
    let m = meteors.find((x) => !x.alive)
    if (!m) m = meteors.reduce((a, b) => (a.t0 < b.t0 ? a : b))
    const o = slot * 4
    m.alive = true
    m.slot = slot
    m.x = rNow[o] + rNow[o + 2] / 2
    m.z = rNow[o + 1] + rNow[o + 3] / 2
    m.t0 = performance.now()
    m.size = Math.min(5.5, 2.2 + Math.sqrt(usd) / 220)
    m.reach = Math.max(6, Math.max(rNow[o + 2], rNow[o + 3]) * 0.75)
    const ink = side === 'buy' ? inks.up : inks.down
    m.head.material.color.set(ink)
    m.trail.material.color.set(ink)
    m.ring.material.color.set(ink)
    // The tag.
    const ctx = m.tagCanvas.getContext('2d')
    if (ctx) {
      const S = 2
      const font = `600 ${12 * S}px ${opts.fontMono}`
      ctx.font = font
      const tw = ctx.measureText(tagText).width
      const pw = Math.ceil(tw + 16 * S)
      const w = Math.ceil(pw / 64) * 64
      const h = 24 * S
      if (m.tagCanvas.width !== w || m.tagCanvas.height !== h) {
        m.tagCanvas.width = w
        m.tagCanvas.height = h
        m.tagTex = renewTexture(m.tagTex, m.tagCanvas, m.tag.material)
      }
      ctx.clearRect(0, 0, w, h)
      ctx.font = font
      const x0 = (w - pw) / 2
      ctx.fillStyle = ink
      roundRect(ctx, x0, 0, pw, h, 7 * S)
      ctx.fill()
      ctx.fillStyle = inks.light ? '#ffffff' : inks.bg
      ctx.textBaseline = 'middle'
      ctx.fillText(tagText, x0 + 8 * S, h / 2 + 1)
      m.tagW = w / S
      m.tagH = h / S
      m.tagTex.needsUpdate = true
    }
    flash[slot] = 1
    flashUp[slot] = side === 'buy' ? 1 : 0
  }

  // ── Camera ─────────────────────────────────────────────────────────────
  function sphericalInto(out: { r: number; polar: number; az: number }): void {
    V.copy(camera.position).sub(controls.target)
    out.r = V.length()
    out.polar = Math.acos(Math.max(-1, Math.min(1, V.y / (out.r || 1))))
    out.az = Math.atan2(V.x, V.z)
  }

  function spherical(): { r: number; polar: number; az: number } {
    V.copy(camera.position).sub(controls.target)
    const r = V.length()
    return { r, polar: Math.acos(Math.max(-1, Math.min(1, V.y / (r || 1)))), az: Math.atan2(V.x, V.z) }
  }

  function placeCamera(target: Vector3, r: number, polar: number, az: number): void {
    controls.target.copy(target)
    camera.position.set(target.x + r * Math.sin(polar) * Math.sin(az), target.y + r * Math.cos(polar), target.z + r * Math.sin(polar) * Math.cos(az))
    camera.lookAt(target)
  }

  /** The distance at which the whole world fits the frame from (polar, az). */
  function fitDistance(polar: number, az: number): number {
    // The land's own corners (a two-row world is narrower in front than its
    // bounding box), at sea level and a little above.
    const corners: [number, number, number][] = []
    for (const c of layout.continents) {
      for (const x of [c.rect.x - 1, c.rect.x + c.rect.w + 1]) for (const z of [c.rect.z - 1, c.rect.z + c.rect.d + 4]) for (const y of [-1, 8]) corners.push([x, y, z])
    }
    if (!corners.length) for (const x of [-worldW / 2, worldW / 2]) for (const z of [-worldD / 2, worldD / 2]) corners.push([x, 0, z])
    // Measure by moving the camera, then put it back where it was.
    const savedPos = V3.copy(camera.position)
    const savedT = SAVED_T.copy(controls.target)
    const target = V2.set(0, 0, 0)
    let lo = 20
    let hi = 6000
    for (let k = 0; k < 28; k++) {
      const mid = (lo + hi) / 2
      placeCamera(target, mid, polar, az)
      camera.updateMatrixWorld()
      let ok = true
      const xMax = 1 - (2 * insetR) / W - 0.04
      const yMin = -1 + (2 * insetB) / H + 0.06
      for (const [x, y, z] of corners) {
        V.set(x, y, z).project(camera)
        if (V.x < -0.97 || V.x > xMax || V.y < yMin || V.y > 0.9 || V.z > 1) {
          ok = false
          break
        }
      }
      if (ok) hi = mid
      else lo = mid
    }
    controls.target.copy(savedT)
    camera.position.copy(savedPos)
    camera.lookAt(savedT)
    camera.updateMatrixWorld()
    return hi
  }

  /** Keep the whole world framed while nobody has flown: the land grows as
   *  markets print and the HUD changes size. At the fit, the camera eases to
   *  the new distance (or jumps, on a resize); on the tour, the orbit's
   *  radius eases toward it. A camera someone flew stays where they left it. */
  function reframe(instant: boolean): void {
    if (!fitted || tween.on) return
    const r = fitDistance(FIT_POLAR, FIT_AZ)
    controls.maxDistance = Math.max(400, r * 2.6)
    if (isAtFit()) {
      if (instant || reduced) {
        placeCamera(V2.set(0, 0, 0), r, FIT_POLAR, FIT_AZ)
        controls.update()
        updateFog()
      } else if (Math.abs(spherical().r - r) > 0.5) startTween(V2.set(0, 0, 0), r, FIT_POLAR, FIT_AZ)
    } else if (touringOn && controls.target.lengthSq() < 1e-6) {
      if (instant) {
        sphericalInto(SPH)
        placeCamera(V2.set(0, 0, 0), r, SPH.polar, SPH.az)
      }
      tourR = r
    }
  }

  const FIT_POLAR = 0.86
  const FIT_AZ = -0.38

  function fitAll(instant = false): void {
    const s = spherical()
    const r = fitDistance(FIT_POLAR, FIT_AZ)
    controls.maxDistance = Math.max(400, r * 2.6)
    tourBasePolar = FIT_POLAR
    tourR = r
    if (instant || reduced || !fitted) {
      placeCamera(V2.set(0, 0, 0), r, FIT_POLAR, FIT_AZ)
      tween.on = false
    } else {
      startTween(V2.set(0, 0, 0), r, FIT_POLAR, FIT_AZ, s)
    }
    controls.update()
    updateFog()
  }

  function startTween(target: Vector3, r: number, polar: number, az: number, from = spherical()): void {
    tween.on = true
    tween.t0 = performance.now()
    tween.from.copy(controls.target)
    tween.to.copy(target)
    tween.r0 = from.r
    tween.r1 = r
    tween.p0 = from.polar
    tween.p1 = polar
    tween.a0 = from.az
    // The short way round.
    let da = az - from.az
    while (da > Math.PI) da -= 2 * Math.PI
    while (da < -Math.PI) da += 2 * Math.PI
    tween.a1 = from.az + da
  }

  function flyTo(key: string): void {
    const slot = slotOf.get(key)
    if (slot === undefined) return
    const o = slot * 4
    const cx = rTo[o] + rTo[o + 2] / 2
    const cz = rTo[o + 1] + rTo[o + 3] / 2
    const side = Math.max(rTo[o + 2], rTo[o + 3])
    const r = Math.max(34, side * 3.2 + Math.abs(hTgt[slot]) * 1.2)
    const s = spherical()
    touringOn = false
    const target = V2.set(cx, Math.max(0, hTgt[slot]) * 0.35, cz)
    if (reduced) {
      placeCamera(target, r, 0.88, s.az)
      controls.update()
      updateFog()
      return
    }
    startTween(target, r, 0.88, s.az, s)
  }

  function flyToContinent(id: ContinentId): void {
    const c = layout.continents.find((x) => x.id === id)
    if (!c) return
    const s = spherical()
    touringOn = false
    const target = V2.set(c.rect.x + c.rect.w / 2, 0, c.rect.z + c.rect.d / 2)
    const r = Math.max(60, c.rect.w * 1.45)
    if (reduced) {
      placeCamera(target, r, 0.92, s.az)
      controls.update()
      updateFog()
      return
    }
    startTween(target, r, 0.92, s.az, s)
  }

  function tour(on: boolean): void {
    touringOn = on && !reduced
    if (touringOn) {
      tween.on = false
      tourClock = 0
      tourBasePolar = spherical().polar
    }
  }

  function nudge(right: number, forward: number): void {
    const s = spherical()
    const step = s.r * 0.06
    V.set(Math.sin(s.az), 0, Math.cos(s.az)) // from target toward the camera, on the ground
    V2.set(V.z, 0, -V.x) // right
    const dx = V2.x * right * step - V.x * forward * step
    const dz = V2.z * right * step - V.z * forward * step
    controls.target.x += dx
    controls.target.z += dz
    camera.position.x += dx
    camera.position.z += dz
    userInput()
    controls.update()
  }

  function climb(dir: number): void {
    const s = spherical()
    const r = Math.max(controls.minDistance, Math.min(controls.maxDistance, s.r * (1 + 0.14 * dir)))
    placeCamera(V2.copy(controls.target), r, s.polar, s.az)
    userInput()
    controls.update()
    updateFog()
  }

  function clampTarget(): void {
    const t = controls.target
    const hx = worldW * 0.75 + 20
    const hz = worldD * 0.75 + 20
    if (t.x > hx) t.x = hx
    if (t.x < -hx) t.x = -hx
    if (t.z > hz) t.z = hz
    if (t.z < -hz) t.z = -hz
    if (t.y < -6) t.y = -6
    if (t.y > 40) t.y = 40
  }

  // ── Picking ────────────────────────────────────────────────────────────
  function pick(clientX: number, clientY: number): string | null {
    const r = canvas.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return null
    NDC.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(NDC, camera)
    let best = Infinity
    let hit = -1
    for (let i = 0; i < highSlot; i++) {
      if (state[i] !== 1) continue
      const o = i * 4
      const top = Math.max(hCur[i], SEABED + 0.3)
      BOX.min.set(rNow[o], SEABED, rNow[o + 1])
      BOX.max.set(rNow[o] + rNow[o + 2], top, rNow[o + 1] + rNow[o + 3])
      if (ray.ray.intersectBox(BOX, HIT)) {
        const dist = HIT.distanceToSquared(ray.ray.origin)
        if (dist < best) {
          best = dist
          hit = i
        }
      }
    }
    return hit >= 0 ? slotKey[hit] : null
  }

  // ── The frame ──────────────────────────────────────────────────────────
  let raf = 0
  let last = performance.now()
  let disposed = false

  function frame(now: number): void {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    if (typeof document !== 'undefined' && document.hidden) {
      last = now
      return
    }
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
    last = now
    frames++

    // Camera: a tween, the tour, or the hand (OrbitControls).
    if (tween.on) {
      const k = Math.min(1, (now - tween.t0) / FLYTO_MS)
      const e = easeInOut(k)
      V2.copy(tween.from).lerp(tween.to, e)
      placeCamera(V2, tween.r0 + (tween.r1 - tween.r0) * e, tween.p0 + (tween.p1 - tween.p0) * e, tween.a0 + (tween.a1 - tween.a0) * e)
      if (k >= 1) tween.on = false
      updateFog()
    } else if (touringOn) {
      tourClock += dt
      sphericalInto(SPH)
      const polar = Math.min(controls.maxPolarAngle - 0.02, Math.max(0.5, tourBasePolar + 0.07 * Math.sin((tourClock * 2 * Math.PI) / 26)))
      const r = tourR > 0 && controls.target.lengthSq() < 1e-6 ? SPH.r + (tourR - SPH.r) * Math.min(1, dt * 1.5) : SPH.r
      placeCamera(V2.copy(controls.target), r, polar, SPH.az + 0.05 * dt)
    }
    clampTarget()
    controls.update()

    // Plots.
    let anyColor = false
    for (let i = 0; i < highSlot; i++) {
      const st = state[i]
      if (st === 0) continue
      const o = i * 4
      const k = Math.min(1, (now - rT0[i]) / RECT_TWEEN_MS)
      const e = reduced ? 1 : easeOut(k)
      rNow[o] = rFrom[o] + (rTo[o] - rFrom[o]) * e
      rNow[o + 1] = rFrom[o + 1] + (rTo[o + 1] - rFrom[o + 1]) * e
      rNow[o + 2] = rFrom[o + 2] + (rTo[o + 2] - rFrom[o + 2]) * e
      rNow[o + 3] = rFrom[o + 3] + (rTo[o + 3] - rFrom[o + 3]) * e
      if (reduced) {
        hCur[i] = hTgt[i]
        hVel[i] = 0
      } else {
        const acc = OMEGA * OMEGA * (hTgt[i] - hCur[i]) - 2 * OMEGA * hVel[i]
        hVel[i] += acc * dt
        hCur[i] += hVel[i] * dt
      }
      if (st === 2 && now - dieAt[i] > DIE_MS) {
        state[i] = 0
        slotKey[i] = null
        plots.setMatrixAt(i, ZERO)
        continue
      }
      let w = rNow[o + 2]
      let d = rNow[o + 3]
      if (st === 2) {
        const f = Math.max(0.05, 1 - (now - dieAt[i]) / DIE_MS)
        w *= f
        d *= f
      }
      const top = Math.max(SEABED + 0.3, hCur[i])
      M.makeScale(Math.max(0.001, w), top - SEABED, Math.max(0.001, d))
      M.setPosition(rNow[o] + rNow[o + 2] / 2, SEABED, rNow[o + 1] + rNow[o + 3] / 2)
      plots.setMatrixAt(i, M)
      // Color: the move, deepening fastest near zero (√), the drops' flash, the hover.
      tCur[i] += (tTgt[i] - tCur[i]) * Math.min(1, dt * 6)
      const t = tCur[i]
      const a = Math.sqrt(Math.abs(t))
      C.copy(neutral).lerp(t >= 0 ? upC : downC, Math.min(1, a))
      if (flash[i] > 0.001) {
        C.lerp(flashUp[i] ? upC : downC, Math.min(0.55, flash[i] * 0.5))
        flash[i] = Math.max(0, flash[i] - dt * 2.6)
      }
      if (i === hoverSlot || i === pinnedSlot) C.lerp(fgC, i === hoverSlot ? 0.3 : 0.16)
      if (st === 2) C.lerp(seabedC, 0.5)
      plots.setColorAt(i, C)
      anyColor = true
    }
    // Trim the tail of free slots.
    while (highSlot > 0 && state[highSlot - 1] === 0) highSlot--
    plots.count = highSlot
    plots.instanceMatrix.needsUpdate = true
    if (anyColor && plots.instanceColor) plots.instanceColor.needsUpdate = true

    // Drops.
    if (dropsAlive > 0) {
      for (let i = 0; i < DROP_POOL; i++) {
        if (!dAlive[i]) continue
        const slot = dSlot[i]
        const t = (now - dT0[i]) / DROP_FALL_MS
        const top = slot >= 0 && state[slot] === 1 ? Math.max(hCur[slot], SEA_Y) : SEA_Y
        if (t < 1) {
          const y0 = top + DROP_FALL_H
          const y = y0 + (top - y0) * t * t
          M.makeScale(dSize[i], dSize[i] * 1.5, dSize[i])
          M.setPosition(dX[i], y + dSize[i] * 0.4, dZ[i])
          drops.setMatrixAt(i, M)
        } else {
          const f = (now - dT0[i] - DROP_FALL_MS) / DROP_FLASH_MS
          if (f >= 1) {
            dAlive[i] = 0
            dropsAlive--
            drops.setMatrixAt(i, ZERO)
          } else {
            const s = dSize[i] * (1 + 1.6 * f) * (1 - f)
            M.makeScale(s * 1.6, s * 0.35, s * 1.6)
            M.setPosition(dX[i], top + 0.15, dZ[i])
            drops.setMatrixAt(i, M)
          }
        }
      }
      drops.instanceMatrix.needsUpdate = true
    }

    // Meteors.
    for (const m of meteors) {
      if (!m.alive) continue
      const age = now - m.t0
      const top = m.slot >= 0 && state[m.slot] === 1 ? Math.max(hCur[m.slot], SEA_Y) : SEA_Y
      const fall = Math.min(1, age / METEOR_FALL_MS)
      if (fall < 1) {
        const y0 = top + METEOR_FALL_H
        const y = y0 + (top - y0) * fall * fall
        m.head.visible = true
        m.head.position.set(m.x, y + m.size, m.z)
        m.head.scale.setScalar(m.size)
        m.trail.visible = true
        const len = Math.min(26, (y0 - y) * 0.9 + 4)
        m.trail.position.set(m.x, y + m.size, m.z)
        m.trail.scale.set(m.size * 0.95, len, m.size * 0.95)
        m.trail.material.opacity = 0.45
        m.ring.visible = false
      } else {
        m.head.visible = false
        m.trail.visible = false
        const rk = (age - METEOR_FALL_MS) / RING_MS
        if (rk < 1) {
          m.ring.visible = true
          m.ring.position.set(m.x, top + 0.25, m.z)
          m.ring.scale.setScalar(1 + rk * m.reach)
          m.ring.material.opacity = 0.9 * (1 - rk)
        } else m.ring.visible = false
      }
      const tk = age / TAG_MS
      if (tk < 1) {
        m.tag.visible = true
        m.tag.position.set(m.x, top + 2 + Math.min(1, age / METEOR_FALL_MS) * 3 + tk * 3, m.z)
        m.tag.scale.set(m.tagW * labelScale, m.tagH * labelScale, 1)
        m.tag.material.opacity = tk < 0.8 ? 1 : 1 - (tk - 0.8) / 0.2
      } else m.tag.visible = false
      if (age > Math.max(METEOR_FALL_MS + RING_MS, TAG_MS)) {
        m.alive = false
        m.head.visible = m.trail.visible = m.ring.visible = m.tag.visible = false
      }
    }

    // Beacons on the pick, flags on the leaders, the pinned outline.
    let b = 0
    for (const key of pickKeys) {
      const slot = slotOf.get(key)
      if (slot === undefined || state[slot] !== 1 || b >= 12) continue
      const o = slot * 4
      const r = Math.max(0.5, Math.min(3, Math.min(rNow[o + 2], rNow[o + 3]) * 0.16))
      M.makeScale(r, BEACON_H, r)
      M.setPosition(rNow[o] + rNow[o + 2] / 2, Math.max(hCur[slot], SEA_Y), rNow[o + 1] + rNow[o + 3] / 2)
      beacons.setMatrixAt(b++, M)
    }
    beacons.count = b
    if (b) beacons.instanceMatrix.needsUpdate = true
    beaconMat.opacity = reduced ? 0.3 : 0.24 + 0.1 * Math.sin(now / 520)
    let f = 0
    for (const fl of flagList) {
      const slot = slotOf.get(fl.key)
      if (slot === undefined || state[slot] !== 1) continue
      const o = slot * 4
      const x = rNow[o] + Math.min(1.2, rNow[o + 2] * 0.2)
      const z = rNow[o + 1] + Math.min(1.2, rNow[o + 3] * 0.2)
      const y = Math.max(hCur[slot], SEA_Y)
      M.makeScale(1, FLAG_H, 1)
      M.setPosition(x, y, z)
      poles.setMatrixAt(f, M)
      M.makeRotationY(reduced ? 0.3 : 0.3 + 0.25 * Math.sin(now / 400 + f))
      M.setPosition(x, y + FLAG_H, z)
      pennants.setMatrixAt(f, M)
      f++
    }
    poles.count = f
    pennants.count = f
    if (f) {
      poles.instanceMatrix.needsUpdate = true
      pennants.instanceMatrix.needsUpdate = true
    }
    if (pinnedSlot >= 0 && state[pinnedSlot] === 1) {
      const o = pinnedSlot * 4
      outline.visible = true
      outline.scale.set(rNow[o + 2] + 0.9, 1, rNow[o + 3] + 0.9)
      outline.position.set(rNow[o] + rNow[o + 2] / 2, Math.max(hCur[pinnedSlot], SEA_Y) + 0.08, rNow[o + 1] + rNow[o + 3] / 2)
    } else outline.visible = false

    if (frames % LABEL_EVERY === 0) placeLabels()
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(frame)

  // ── Size ───────────────────────────────────────────────────────────────
  /** Shift the picture's centre left by half the right inset and up by half
   *  the bottom one: the world sits in the middle of the space the HUD leaves. */
  function applyViewOffset(): void {
    const dx = Math.min(insetR, W * 0.45) / 2
    const dy = Math.min(insetB, H * 0.35) / 2
    if (dx < 1 && dy < 1) camera.clearViewOffset()
    else camera.setViewOffset(W + 2 * dx, H + 2 * dy, 2 * dx, 2 * dy, W, H)
    camera.updateProjectionMatrix()
  }

  function setInsets(right: number, bottom: number): void {
    const r = Math.max(0, Math.round(right))
    const b = Math.max(0, Math.round(bottom))
    if (r === insetR && b === insetB) return
    insetR = r
    insetB = b
    applyViewOffset()
    reframe(true)
  }

  function isAtFit(): boolean {
    const s = spherical()
    return Math.abs(s.az - FIT_AZ) < 1e-3 && Math.abs(s.polar - FIT_POLAR) < 1e-3 && controls.target.lengthSq() < 1e-6
  }

  function resize(): void {
    W = Math.max(1, canvas.clientWidth)
    H = Math.max(1, canvas.clientHeight)
    renderer.setSize(W, H, false)
    camera.aspect = W / H
    applyViewOffset()
    // Keep the frame's subject while nobody has flown.
    reframe(true)
    placeLabels()
  }
  resize()
  applyInks()
  // Compile every program now, with the pooled objects shown for the moment:
  // a material compiled on its first visible frame (the first meteor, the
  // first flag) is a hitch of tens of milliseconds mid-flight.
  {
    const hidden: { visible: boolean }[] = []
    for (const m of meteors) for (const o of [m.head, m.trail, m.ring, m.tag]) if (!o.visible) (o.visible = true, hidden.push(o))
    for (const o of [outline]) if (!o.visible) (o.visible = true, hidden.push(o))
    const counts = [beacons.count, poles.count, pennants.count]
    beacons.count = poles.count = pennants.count = 1
    try {
      renderer.compile(scene, camera)
    } catch {
      // a driver that refuses an early compile compiles on first use instead
    }
    for (const o of hidden) o.visible = false
    ;[beacons.count, poles.count, pennants.count] = counts
  }

  return {
    setWorld,
    setHeights,
    setColors,
    setLabels,
    setContinentLabels,
    setSea(on: boolean) {
      seaOn = on
      applySeaMode()
    },
    setInsets,
    setExclusions(rects) {
      const a = new Float32Array(rects.length * 4)
      rects.forEach((r, i) => a.set([r.x0, r.y0, r.x1, r.y1], i * 4))
      EXCL = a
    },
    drop,
    meteor,
    setPick,
    setFlags,
    setHover,
    setPinned,
    flyTo,
    flyToContinent,
    fitAll: () => fitAll(false),
    tour,
    touring: () => touringOn,
    nudge,
    climb,
    resize,
    setInks(next: SceneInks) {
      inks = next
      applyInks()
    },
    setReducedMotion(on: boolean) {
      reduced = on
      if (on) touringOn = false
    },
    pick,
    onInteract(cb: () => void) {
      interactCb = cb
    },
    stats: () => {
      let live = 0
      for (let i = 0; i < highSlot; i++) if (state[i] === 1) live++
      let shown = 0
      for (const e of labels.values()) if (e.sprite.visible) shown++
      const t = controls.target
      const c = camera.position
      const camera_ = `calls ${renderer.info.render.calls} t ${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)} c ${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)} vp ${W}x${H} in ${insetR},${insetB} world ${worldW.toFixed(0)}x${worldD.toFixed(0)} tour ${touringOn ? 1 : 0}`
      return { plots: live, drops: dropsAlive, frames, labels: shown, camera: camera_ }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      controls.removeEventListener('start', userInput)
      controls.dispose()
      for (const e of labels.values()) {
        e.sprite.material.dispose()
        e.tex.dispose()
      }
      labels.clear()
      for (const g of ground.values()) {
        g.sprite.material.dispose()
        g.tex.dispose()
      }
      ground.clear()
      for (const m of meteors) {
        m.head.material.dispose()
        m.trail.material.dispose()
        m.ring.material.dispose()
        ;(m.tag.material as SpriteMaterial).dispose()
        m.tagTex.dispose()
      }
      for (const g of [planeGeo, boxGeo, squareGeo, beaconGeo, poleGeo, pennantGeo, dropGeo, headGeo, trailGeo, ringGeo, lines.geometry]) g.dispose()
      for (const m of [seaMat, linesMat, plotMat, outlineMat, beaconMat, poleMat, pennantMat, dropMat]) m.dispose()
      plots.dispose()
      drops.dispose()
      beacons.dispose()
      poles.dispose()
      pennants.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/** Can this browser draw the world at all? (The page says so in words when not.) */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}
