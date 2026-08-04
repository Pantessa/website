// Protocol brand marks — the single source of truth for vendored logos.
//
// Simple Icons doesn't carry these DeFi marks (and renders some poorly), so
// they're hand-vendored as monochrome `currentColor` SVGs from the official
// open-source interfaces. Rendering in `currentColor` means each consumer
// controls the color: white on a dark avatar tile, the brand hue on the hero
// medallions (via `--pc`), a brand-color medallion on the landing demo cards.
//
// Consumers: <BrandIcon> (chat rail · server pages · directory cards ·
// leaderboard), the fusion hero medallions, and the EmbedAnywhere demo cards.
//
// ADDING A LOGO AS NEW SERVER PAGES COME IN:
//   1. Add a `<Foo>Mark` component below (monochrome, `fill="currentColor"`).
//   2. Add a `{ match, Mark }` row to REGISTRY — `match` is tested against the
//      server's iconSlug / slug / id / name, so `/foo/i` catches `foo`,
//      `foo-free`, `foo-mcp`, etc. That's the whole wiring — every surface
//      (BrandIcon and the hero) picks it up automatically.

import { useId, type ComponentType } from 'react'

export type Mark = ComponentType<{ size?: number }>

export function UniswapMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} fill="none" aria-hidden style={{ display: 'block' }}>
      <path fill="currentColor" d="M32.13 9.558c-1.183-.181-1.233-.202-.676-.287 1.067-.161 3.587.059 5.324.466 4.054.949 7.743 3.38 11.681 7.7l1.046 1.147 1.497-.237c6.305-.998 12.719-.205 18.083 2.236 1.476.672 3.803 2.009 4.094 2.352.093.11.263.815.378 1.567.398 2.601.199 4.596-.609 6.085-.44.81-.464 1.068-.169 1.762.236.553.894.963 1.546.962 1.333-.002 2.768-2.125 3.432-5.078l.265-1.174.523.584c2.87 3.203 5.124 7.57 5.51 10.68l.102.81-.483-.737c-.83-1.268-1.664-2.131-2.732-2.827-1.926-1.255-3.961-1.682-9.353-1.962-4.87-.253-7.626-.663-10.359-1.54-4.65-1.494-6.993-3.483-12.516-10.62-2.453-3.17-3.97-4.925-5.478-6.338-3.427-3.21-6.795-4.893-11.106-5.551Z"/>
      <path fill="currentColor" d="M74.277 16.636c.123-2.124.415-3.525 1.003-4.805.233-.507.451-.921.485-.921.034 0-.068.374-.225.83-.428 1.243-.498 2.941-.203 4.918.374 2.507.586 2.87 3.277 5.578 1.262 1.27 2.73 2.873 3.262 3.56l.968 1.252-.968-.894c-1.183-1.093-3.905-3.226-4.506-3.53-.403-.205-.463-.201-.711.043-.23.224-.278.562-.31 2.157-.049 2.487-.393 4.083-1.224 5.679-.449.863-.52.679-.113-.295.303-.728.334-1.048.332-3.455-.005-4.837-.588-6-4.006-7.991a37.732 37.732 0 0 0-3.171-1.618c-.878-.385-1.576-.72-1.55-.745.096-.095 3.43.863 4.772 1.372 1.996.756 2.326.854 2.568.763.163-.061.241-.527.32-1.898ZM34.43 24.91c-2.403-3.257-3.89-8.253-3.568-11.987l.1-1.155.546.098c1.027.184 2.798.834 3.627 1.33 2.276 1.36 3.26 3.153 4.263 7.755.293 1.348.678 2.873.856 3.39.285.83 1.363 2.772 2.24 4.033.63.908.212 1.339-1.184 1.215-2.131-.19-5.018-2.152-6.88-4.678ZM71.363 49.16c-11.227-4.454-15.182-8.319-15.182-14.84 0-.96.034-1.745.075-1.745.04 0 .475.316.965.703 2.277 1.8 4.826 2.568 11.884 3.582 4.153.597 6.49 1.079 8.647 1.783 6.853 2.239 11.093 6.782 12.104 12.97.293 1.798.121 5.17-.355 6.947-.376 1.404-1.524 3.934-1.828 4.03-.085.027-.167-.291-.19-.725-.115-2.323-1.306-4.585-3.308-6.28-2.276-1.926-5.335-3.46-12.812-6.426ZM63.481 51.01c-.14-.825-.385-1.878-.542-2.34l-.287-.842.532.589c.737.814 1.319 1.856 1.812 3.243.376 1.06.419 1.374.416 3.095-.003 1.69-.05 2.044-.398 2.997-.548 1.503-1.228 2.57-2.37 3.713-2.05 2.056-4.687 3.195-8.492 3.667-.662.082-2.59.22-4.284.307-4.271.219-7.082.67-9.608 1.544-.363.126-.688.202-.72.17-.103-.1 1.617-1.11 3.038-1.784 2.002-.95 3.996-1.47 8.464-2.202 2.206-.362 4.485-.801 5.064-.976 5.465-1.65 8.274-5.91 7.375-11.182Z"/>
      <path fill="currentColor" d="M68.628 60.013c-1.492-3.159-1.834-6.209-1.017-9.053.087-.304.228-.553.313-.553.084 0 .436.188.782.417.687.456 2.066 1.224 5.739 3.196 4.583 2.462 7.197 4.368 8.974 6.545 1.556 1.908 2.52 4.08 2.983 6.728.262 1.5.108 5.11-.282 6.621-1.233 4.764-4.097 8.506-8.182 10.69-.599.319-1.136.582-1.194.583-.058.001.16-.545.485-1.214 1.374-2.83 1.53-5.582.491-8.646-.636-1.876-1.933-4.165-4.552-8.033-3.044-4.498-3.791-5.695-4.54-7.281ZM26.456 77.056c4.166-3.465 9.35-5.927 14.073-6.682 2.035-.326 5.425-.197 7.31.278 3.02.762 5.723 2.467 7.128 4.5 1.373 1.986 1.963 3.716 2.576 7.567.242 1.519.505 3.044.585 3.39.46 1.995 1.357 3.59 2.468 4.392 1.765 1.272 4.803 1.351 7.792.203.508-.195.948-.33.98-.3.107.106-1.398 1.099-2.46 1.621-1.428.703-2.564.975-4.074.975-2.738 0-5.01-1.372-6.907-4.169-.373-.55-1.212-2.2-1.864-3.664-2.002-4.499-2.991-5.87-5.316-7.369-2.023-1.305-4.633-1.539-6.596-.59-2.578 1.245-3.298 4.49-1.451 6.547.734.818 2.103 1.523 3.222 1.66 2.094.257 3.893-1.312 3.893-3.395 0-1.352-.527-2.123-1.855-2.714-1.814-.806-3.764.136-3.755 1.815.004.716.32 1.165 1.049 1.49.467.208.478.225.097.147-1.664-.34-2.054-2.317-.716-3.629 1.607-1.575 4.93-.88 6.07 1.27.48.903.535 2.702.117 3.788-.935 2.431-3.662 3.71-6.429 3.014-1.883-.474-2.65-.987-4.92-3.29-3.947-4.005-5.479-4.78-11.168-5.655l-1.09-.168 1.24-1.032Z"/>
      <path fill="currentColor" fillRule="evenodd" d="M7.94 5.395C21.12 21.149 30.196 27.65 31.204 29.023c.833 1.134.52 2.153-.907 2.952-.793.444-2.424.894-3.241.894-.924 0-1.241-.35-1.241-.35-.536-.501-.837-.413-3.588-5.222-3.818-5.837-7.013-10.678-7.1-10.76-.202-.187-.199-.18 6.711 11.998 1.116 2.538.222 3.47.222 3.832 0 .735-.204 1.122-1.125 2.134-1.535 1.687-2.221 3.583-2.717 7.506-.555 4.398-2.117 7.505-6.445 12.822-2.534 3.112-2.948 3.683-3.588 4.937-.805 1.58-1.026 2.465-1.116 4.46-.095 2.109.09 3.472.744 5.488.573 1.766 1.17 2.931 2.699 5.263 1.319 2.012 2.078 3.507 2.078 4.092 0 .466.09.466 2.134.012 4.89-1.088 8.862-3.001 11.096-5.346 1.382-1.452 1.707-2.253 1.717-4.242.007-1.3-.04-1.573-.396-2.322-.581-1.218-1.64-2.23-3.971-3.8-3.055-2.058-4.36-3.714-4.72-5.992-.296-1.869.047-3.187 1.737-6.677 1.75-3.612 2.183-5.15 2.476-8.791.19-2.352.452-3.28 1.138-4.024.715-.777 1.36-1.04 3.13-1.278 2.887-.389 4.725-1.124 6.236-2.496 1.311-1.19 1.86-2.336 1.944-4.062l.064-1.308-.733-.841C31.788 24.855 6.164 3 6.001 3c-.035 0 .838 1.078 1.94 2.395Zm6.138 61.217a2.293 2.293 0 0 0-.722-3.048c-.948-.62-2.42-.328-2.42.48 0 .248.138.427.45.585.527.267.565.567.15 1.18-.418.62-.384 1.166.096 1.536.775.598 1.872.27 2.446-.733ZM36.995 37.295c-1.355.41-2.672 1.825-3.08 3.308-.249.906-.108 2.493.265 2.983.602.792 1.184 1.001 2.76.99 3.087-.021 5.77-1.325 6.082-2.955.256-1.336-.923-3.188-2.546-4-.837-.42-2.619-.586-3.48-.326Zm3.608 2.78c.476-.667.268-1.387-.541-1.874-1.542-.927-3.873-.16-3.873 1.275 0 .714 1.216 1.493 2.33 1.493.742 0 1.757-.436 2.084-.895Z" clipRule="evenodd"/>
    </svg>
  )
}

export function CowMark({ size = 22 }: { size?: number }) {
  // Natural 3:2 landscape mark; keep the aspect and center it in a square box.
  return (
    <svg viewBox="0 0 36 24" width={size} height={(size * 24) / 36} fill="none" aria-hidden style={{ display: 'block' }}>
      <path fill="currentColor" fillRule="evenodd" d="M13.653 24a4.011 4.011 0 0 1-3.824-2.79L7.11 12.666H5.44a4.01 4.01 0 0 1-3.825-2.791L0 4.8h6.058L2.863 0h30.274l-3.195 4.8H36l-1.615 5.076a4.01 4.01 0 0 1-3.825 2.79h-1.67l-2.72 8.544A4.01 4.01 0 0 1 22.346 24h-8.693ZM11.6 10.333c0 1.289.965 2.334 2.156 2.334 1.19 0 2.155-1.045 2.155-2.334 0-1.288-.965-2.333-2.155-2.333S11.6 9.045 11.6 10.333Zm12.8 0c0 1.289-.965 2.334-2.156 2.334-1.19 0-2.155-1.045-2.155-2.334 0-1.288.965-2.333 2.155-2.333S24.4 9.045 24.4 10.333Z" clipRule="evenodd"/>
    </svg>
  )
}

export function SnapshotMark({ size = 22 }: { size?: number }) {
  // Snapshot's lightning-bolt motif (snapshot.org / snapshot.box).
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M13 2 L4 14 h6 l-1 8 L20 9 h-6 z" />
    </svg>
  )
}

export function AaveMark({ size = 22 }: { size?: number }) {
  // Aave's "ghost" logomark (official Logomark, aave.com). Natural ~1.9:1
  // landscape mark; keep the aspect and center it in a square box.
  return (
    <svg viewBox="0 0 266 139" width={size} height={(size * 139) / 266} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M97.542 138.533c14.919 0 27.014-12.095 27.014-27.015s-12.095-27.014-27.014-27.014c-14.92 0-27.015 12.095-27.015 27.014 0 14.92 12.095 27.015 27.015 27.015m70.607 0c14.92 0 27.015-12.095 27.015-27.015s-12.095-27.014-27.015-27.014-27.014 12.095-27.014 27.014c0 14.92 12.095 27.015 27.014 27.015" />
      <path d="M132.8 0C59.45 0-.02 60.602 0 135.335h33.926c0-56.007 43.917-101.415 98.874-101.415s98.874 45.408 98.874 101.415H265.6C265.613 60.602 206.144 0 132.8 0" />
    </svg>
  )
}

export function NearMark({ size = 22 }: { size?: number }) {
  // NEAR Protocol's "N" logomark — the official brandmark (near.org), the
  // positive-glyph form of the rounded-square badge. Square 1:1 mark.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M21.443 0c-.89 0-1.714.46-2.18 1.218l-5.017 7.448a.533.533 0 0 0 .792.7l4.938-4.282a.2.2 0 0 1 .334.151v13.41a.2.2 0 0 1-.354.128L5.03.905A2.555 2.555 0 0 0 3.078 0h-.521A2.557 2.557 0 0 0 0 2.557v18.886a2.557 2.557 0 0 0 4.736 1.338l5.017-7.448a.533.533 0 0 0-.792-.7l-4.938 4.283a.2.2 0 0 1-.333-.152V5.352a.2.2 0 0 1 .354-.128l14.924 17.87c.486.574 1.2.905 1.952.906h.521A2.558 2.558 0 0 0 24 21.445V2.557A2.558 2.558 0 0 0 21.443 0Z" />
    </svg>
  )
}

export function LidoMark({ size = 22 }: { size?: number }) {
  // Lido's droplet logomark (lido.fi) — the two upper petals + lower bowl of
  // the staked-ETH drop. Square 1:1 mark.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M11.9971 14.1288L6.89102 11.1299L6.74656 11.3491C5.98362 12.5558 5.65201 13.9856 5.80581 15.405C5.9596 16.8245 6.58972 18.1499 7.59342 19.1652C8.16999 19.7467 8.85597 20.2081 9.6118 20.523C10.3676 20.8378 11.1784 21 11.9971 21C12.8159 21 13.6267 20.8378 14.3824 20.523C15.1383 20.2081 15.8242 19.7467 16.4008 19.1652C17.4077 18.1518 18.04 16.826 18.1939 15.4055C18.3478 13.9852 18.0143 12.5549 17.2476 11.3491L17.1033 11.1299L11.9971 14.1288Z" />
      <path d="M12.002 3L16.4057 9.94929L12.002 12.5347V3Z" />
      <path d="M12.0024 3V12.5347L7.59863 9.94431L12.0024 3Z" />
    </svg>
  )
}

export function HyperliquidMark({ size = 22 }: { size?: number }) {
  // Hyperliquid's wave logomark (hyperliquid.xyz / HyperEVM). Wide glyph in a
  // square 1:1 viewBox, vertically centered as shipped by the brand.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M20.9994 11.9374C21.0158 13.3707 20.7065 14.7403 20.099 16.0488C19.2315 17.9121 17.1518 19.4356 15.2526 17.8139C13.7037 16.4921 13.4163 13.8086 11.0958 13.4158C8.02535 13.0548 7.95146 16.5079 5.94557 16.8981C3.70981 17.3388 2.9682 13.6918 3.00104 12.0356C3.03388 10.3793 3.48814 8.05158 5.4311 8.05158C7.66686 8.05158 7.81737 11.3349 10.6552 11.157C13.4656 10.9712 13.5149 7.55523 15.3511 6.09275C16.9355 4.82933 18.7992 5.75566 19.7323 7.27654C20.5971 8.68328 20.9775 10.3342 20.9967 11.9374H20.9994Z" />
    </svg>
  )
}

export function RobinhoodMark({ size = 22 }: { size?: number }) {
  // Robinhood's feather logomark (robinhood.com), vendored from the official
  // Simple Icons single-path glyph. Square 1:1 mark.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852" />
    </svg>
  )
}

export function OpenseaMark({ size = 22 }: { size?: number }) {
  // OpenSea's ship-in-circle logomark (opensea.io), vendored from the
  // official Simple Icons single-path glyph. Square 1:1 mark.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path d="M12 0C5.374 0 0 5.374 0 12s5.374 12 12 12 12-5.374 12-12S18.629 0 12 0ZM5.92 12.403l.051-.081 3.123-4.884a.107.107 0 0 1 .187.014c.52 1.169.972 2.623.76 3.528-.088.372-.335.876-.614 1.342a2.405 2.405 0 0 1-.117.199.106.106 0 0 1-.09.045H6.013a.106.106 0 0 1-.091-.163zm13.914 1.68a.109.109 0 0 1-.065.101c-.243.103-1.07.485-1.414.962-.878 1.222-1.548 2.97-3.048 2.97H9.053a4.019 4.019 0 0 1-4.013-4.028v-.072c0-.058.048-.106.108-.106h3.485c.07 0 .12.063.115.132-.026.226.017.459.125.67.206.42.636.682 1.099.682h1.726v-1.347H9.99a.11.11 0 0 1-.089-.173l.063-.09c.16-.231.391-.586.621-.992.156-.274.308-.566.43-.86.024-.052.043-.107.065-.16.033-.094.067-.182.091-.269a4.57 4.57 0 0 0 .065-.223c.057-.25.081-.514.081-.787 0-.108-.004-.221-.014-.327-.005-.117-.02-.235-.034-.352a3.415 3.415 0 0 0-.048-.312 6.494 6.494 0 0 0-.098-.468l-.014-.06c-.03-.108-.056-.21-.09-.317a11.824 11.824 0 0 0-.328-.972 5.212 5.212 0 0 0-.142-.355c-.072-.178-.146-.339-.213-.49a3.564 3.564 0 0 1-.094-.197 4.658 4.658 0 0 0-.103-.213c-.024-.053-.053-.104-.072-.152l-.211-.388c-.029-.053.019-.118.077-.101l1.32.357h.01l.173.05.192.054.07.019v-.783c0-.379.302-.686.679-.686a.66.66 0 0 1 .477.202.69.69 0 0 1 .2.484V6.65l.141.039c.01.005.022.01.031.017.034.024.084.062.147.11.05.038.103.086.165.137a10.351 10.351 0 0 1 .574.504c.214.199.454.432.684.691.065.074.127.146.192.226.062.079.132.156.19.232.079.104.16.212.235.324.033.053.074.108.105.161.096.142.178.288.257.435.034.067.067.141.096.213.089.197.159.396.202.598a.65.65 0 0 1 .029.132v.01c.014.057.019.12.024.184a2.057 2.057 0 0 1-.106.874c-.031.084-.06.17-.098.254-.075.17-.161.343-.264.502-.034.06-.075.122-.113.182-.043.063-.089.123-.127.18a3.89 3.89 0 0 1-.173.221c-.053.072-.106.144-.166.209-.081.098-.16.19-.245.278-.048.058-.1.118-.156.17-.052.06-.108.113-.156.161-.084.084-.15.147-.208.202l-.137.122a.102.102 0 0 1-.072.03h-1.051v1.346h1.322c.295 0 .576-.104.804-.298.077-.067.415-.36.816-.802a.094.094 0 0 1 .05-.03l3.65-1.057a.108.108 0 0 1 .138.103z" />
    </svg>
  )
}

export function MorphoMark({ size = 22 }: { size?: number }) {
  // Morpho's butterfly-wing logomark (morpho.org header), vendored from the
  // site's own monochrome variant — the two outer wings carry the brand's
  // 0.8 opacity, which is what gives the mark its depth in one color. Natural
  // 22:20 landscape mark; keep the aspect and center it in a square box.
  return (
    <svg viewBox="0 0 22 20" width={size} height={(size * 20) / 22} fill="currentColor" aria-hidden style={{ display: 'block' }}>
      <path opacity="0.8" d="M2.5321 13.5905V19.4119C2.5321 19.7702 2.83539 19.919 2.92975 19.9528C3.0241 19.9934 3.34086 20.0813 3.62393 19.8176L8.02782 15.5854C8.40286 15.2251 8.76481 14.8463 9.03681 14.403C9.16483 14.1947 9.2179 14.0773 9.2179 14.0773C9.48752 13.5296 9.48752 13.0023 9.22456 12.4749C8.83382 11.6906 7.83626 10.8928 6.33325 10.1355L3.76547 11.5689C3.0039 12.0016 2.5321 12.7656 2.5321 13.5905Z" />
      <path d="M0 0.642806V6.74819C0 7.5122 0.512226 8.18831 1.24012 8.40467C3.72033 9.12136 8.04046 10.6629 9.08514 12.9279C9.21983 13.2254 9.30074 13.5162 9.32787 13.8204C10.022 12.5561 10.3388 11.1024 10.1905 9.62844C9.98823 7.53924 8.88286 5.63933 7.15759 4.42908L1.00423 0.122192C0.89638 0.0410568 0.768328 0.000488281 0.640278 0.000488281C0.53243 0.000488281 0.438076 0.0207726 0.336987 0.0748625C0.134785 0.189803 0 0.399404 0 0.642806Z" />
      <path opacity="0.8" d="M18.9118 13.5905V19.4119C18.9118 19.7702 18.6086 19.919 18.5141 19.9528C18.4199 19.9934 18.1029 20.0813 17.82 19.8176L13.3135 15.487C13.0068 15.1922 12.7139 14.8804 12.4828 14.5231C12.2998 14.2403 12.226 14.0773 12.226 14.0773C11.9564 13.5296 11.9564 13.0023 12.2191 12.4749C12.6101 11.6906 13.6077 10.8928 15.1105 10.1355L17.6784 11.5689C18.4468 12.0016 18.9118 12.7656 18.9118 13.5905Z" />
      <path d="M21.4481 0.642318V6.74769C21.4481 7.5117 20.9357 8.18782 20.2078 8.40418C17.7277 9.12086 13.4076 10.6624 12.3629 12.9274C12.228 13.2249 12.1471 13.5157 12.1202 13.8199C11.426 12.5556 11.1093 11.1019 11.2576 9.62797C11.4596 7.53874 12.565 5.63886 14.2905 4.4286L20.4439 0.121701C20.5517 0.0405662 20.6797 0 20.8077 0C20.9155 0 21.01 0.0202842 21.1109 0.0743741C21.3132 0.189315 21.4481 0.398914 21.4481 0.642318Z" />
    </svg>
  )
}

export function YeetfulMark({ size = 22 }: { size?: number }) {
  // Pantessa's own agent-graph "Y" mark — three nodes wired to a central hub
  // (identical geometry to components/Logo.tsx and
  // public/design-system/assets/yeetful-mark.svg). Used for the first-party
  // `yeetful-tool-*` internal MCPs so they carry the brand mark instead of a
  // bare Archivo "Y" lettermark. Pure `currentColor` art, so it inverts with
  // the tile like every other mark here. The mask punches the hub center out
  // where the spokes converge; a per-instance id keeps multiple marks on one
  // page from colliding.
  const maskId = `yf-hub-${useId().replace(/:/g, '')}`
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" aria-hidden style={{ display: 'block' }}>
      <mask id={maskId}>
        <rect width="40" height="40" fill="#fff" />
        <circle cx="20" cy="20" r="1.9" fill="#000" />
      </mask>
      <g mask={`url(#${maskId})`} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <line x1="20" y1="20" x2="9" y2="9" />
        <line x1="20" y1="20" x2="31" y2="9" />
        <line x1="20" y1="20" x2="20" y2="33" />
      </g>
      <g fill="currentColor">
        <circle cx="9" cy="9" r="4.4" />
        <circle cx="31" cy="9" r="4.4" />
        <circle cx="20" cy="33" r="4.4" />
      </g>
      <circle cx="20" cy="20" r="3" fill="none" stroke="currentColor" strokeWidth={2.2} />
    </svg>
  )
}

// slug/name matcher → mark. Ordered; first match wins. The regex is tested
// against a space-joined string of iconSlug/slug/id/name, so `-free`/`-mcp`
// suffixes and display names all resolve to the same mark.
const REGISTRY: { match: RegExp; Mark: Mark }[] = [
  { match: /uniswap/i, Mark: UniswapMark },
  { match: /(^|[^a-z])cow([^a-z]|$)|cowswap|cow-?protocol/i, Mark: CowMark },
  { match: /snapshot/i, Mark: SnapshotMark },
  { match: /aave/i, Mark: AaveMark },
  // \bnear\b (not /near/) so "near-intents-free" / "NEAR Intents" match but
  // "linear" doesn't.
  { match: /\bnear\b|near-intents/i, Mark: NearMark },
  { match: /lido/i, Mark: LidoMark },
  { match: /hyperliquid|hyper-?evm/i, Mark: HyperliquidMark },
  { match: /robinhood/i, Mark: RobinhoodMark },
  { match: /opensea|seaport/i, Mark: OpenseaMark },
  { match: /morpho/i, Mark: MorphoMark },
  // First-party internal MCPs (the documented `yeetful-tool-*` prefix, plus
  // their display names) — carry Pantessa's own mark. Deliberately narrow so it
  // never catches `yeetful-claude` (the paid Anthropic inference MCP, which
  // keeps its Anthropic icon via ICON_SLUG in BrandIcon).
  { match: /yeetful-tool|(yeetful|pantessa) (wallet|funding)/i, Mark: YeetfulMark },
]

/** Resolve a vendored protocol mark from any of a server's identifiers.
 *  Returns null when none matches (caller falls back to a lettermark). */
export function getProtocolMark(...keys: (string | null | undefined)[]): Mark | null {
  const hay = keys.filter(Boolean).join(' ')
  if (!hay) return null
  for (const { match, Mark } of REGISTRY) if (match.test(hay)) return Mark
  return null
}
