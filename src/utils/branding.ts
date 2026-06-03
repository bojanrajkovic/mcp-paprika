import sharp from "sharp";

/**
 * Connector branding — the identity `mcp-paprika` presents to MCP hosts.
 *
 * Host rendering of this metadata is uneven (see `docs/http-transport.md`
 * "Connector appearance"); the fields exist on three different surfaces:
 *
 * - `title` / `websiteUrl` ride in `serverInfo` (the MCP `Implementation`),
 *   which a host reads only *after* the client connects.
 * - `icons` rides in `serverInfo` too, as a self-contained SVG data URI —
 *   spec-native (SEP-973), but Claude.ai does not render `serverInfo` icons yet
 *   (anthropics/claude-ai-mcp#152), and under the HTTP transport `serverInfo`
 *   is behind OAuth, so the pre-auth connector card can never read it.
 * - The PNG served at {@link FAVICON_PATH} plus `logo_uri` in the OAuth
 *   authorization-server metadata are the *pre-auth* surfaces a connector card
 *   can actually reach — wired in `src/auth/metadata.ts` and `src/transport/`.
 *
 * The hand-authored SVG below is the single source of truth: the favicon PNG is
 * rasterized from it; the `serverInfo` data URI embeds it verbatim.
 */
export const BRANDING = {
  title: "Paprika",
  websiteUrl: "https://github.com/bojanrajkovic/mcp-paprika",
} as const;

/**
 * Path the icon PNG is served at under the HTTP transport. The authorization-
 * server metadata `logo_uri` is built as `${issuer}${FAVICON_PATH}`, so the
 * route (`src/transport/favicon.ts`) and the advertised URL stay in lockstep
 * from one constant.
 */
export const FAVICON_PATH = "/favicon.png";

/**
 * A bold "P" on a paprika-red (#C0392B) rounded tile.
 *
 * The letterform is the capital P of **Baloo 2** Bold (wght 700), an OFL typeface
 * by Ek Type, with its glyph *outline* extracted to this path at authoring time
 * (via fonttools) and baked in. Nothing reads a font at runtime: the distroless
 * image ships no fonts, so a `<text>` element would render blank — a baked
 * outline rasterizes identically everywhere. OFL permits embedding glyph outlines
 * in artwork; only this single extracted outline lives here, never the font file.
 *
 * The `transform` optically centers the glyph. A "P" carries its mass up and to
 * the left (full-height stem + top bowl, empty bottom-right), so geometric
 * bounding-box centering reads as shoved up-left; the offset nudges it ~60% of
 * the way from bbox-center toward the inked centroid (down-and-right), which the
 * eye reads as centered — hence the asymmetry the centering test asserts. The `d`
 * coordinates are Baloo 2 font units (y-up); the transform scales, y-flips, and
 * positions them in the 128×128 tile.
 */
const ICON_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
  `<rect width="128" height="128" rx="26" fill="#C0392B"/>` +
  `<path transform="translate(39.157 30.66) scale(0.11759 -0.11759) translate(-70.8 -622.0)" ` +
  `d="M222.4 315.4H282.2Q332.6 315.4 362.5 339Q392.4 362.6 392.4 407.8Q392.4 453 364.4 476.2Q336.3 499.3 283.2 499.3Q264.5 499.3 250.2 498.3Q235.8 497.4 222.4 494.9ZM291.8 195H70.8V552.6Q70.8 572.4 81.9 583.2Q93.1 594 111.4 600.5Q144.2 611.8 189.8 616.9Q235.5 622 273 622Q407.6 622 477.5 564.4Q547.4 506.7 547.4 408.1Q547.4 343.8 516.7 295.9Q486 248 429 221.5Q372 195 291.8 195ZM70.8 262.1H223.4V1.2Q213.6 -1.5 193.8 -4.4Q173.9 -7.3 152.8 -7.3Q108 -7.3 89.4 8.9Q70.8 25.2 70.8 64.7Z" ` +
  `fill="#FFFFFF"/>` +
  `</svg>`;

/**
 * `serverInfo.icons[].src`: the icon as a self-contained `image/svg+xml` data
 * URI. Synchronous and transport-agnostic — stdio has no URL to point at — so
 * this is the form `serverInfo` advertises.
 */
export function iconSvgDataUri(): string {
  return `data:image/svg+xml;base64,${Buffer.from(ICON_SVG).toString("base64")}`;
}

let pngBuffer: Promise<Buffer> | null = null;

/**
 * The 128×128 PNG rasterization of the icon, memoized for the process. Used to
 * serve {@link FAVICON_PATH}. sharp is already a dependency (photo handling);
 * rasterizing one static SVG once at first request is negligible. This is an
 * infra boundary, so the returned promise may reject (it won't for a constant
 * SVG) rather than following the neverthrow core convention.
 */
export function iconPng(): Promise<Buffer> {
  pngBuffer ??= sharp(Buffer.from(ICON_SVG)).resize(128, 128).png().toBuffer();
  return pngBuffer;
}
