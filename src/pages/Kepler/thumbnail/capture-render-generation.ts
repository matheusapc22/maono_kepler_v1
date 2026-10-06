import { acknowledgePointClusterWitnesses, pointClusterLayerWitnesses, pointClusterWitnessesMatch, type PointClusterLayerWitness, type PointClusterCaptureExpectation } from "../clustering/point-cluster-render-provenance.ts";
/** Capture provenance comes from MapContainer's consumed props, not the newest
 * Redux state observed elsewhere in the tree. References are compared only in
 * this editor session and are never serialized, logged or sent to the server. */
function read(value: any, key: string) { return typeof value?.get === "function" ? value.get(key) : value?.[key]; }
function values(value: any, keys: string[]) { return keys.map((key) => read(value, key)); }
export function mapCaptureRenderInputs(state: any): unknown[] {
  const vis = read(state, "visState"), style = read(state, "mapStyle");
  return [
    ...values(vis, ["datasets", "layers", "layerData", "layerOrder", "filters", "effects", "effectOrder", "layerBlending", "overlayBlending", "splitMaps"]),
    ...values(read(vis, "animationConfig"), ["currentTime", "speed"]),
    ...values(read(vis, "editor"), ["features", "visible"]),
    ...values(style, ["styleType", "topLayerGroups", "visibleLayerGroups", "threeDBuildingColor", "backgroundColor", "mapStyles"]),
  ];
}

type DeckProps = { layers?: unknown };
type Provenance = { inputs: unknown[]; layers: unknown; sequence: number; clusterWitnesses: readonly PointClusterLayerWitness[] };
const consumedInputs = new WeakMap<object, { inputs: unknown[]; clusterWitnesses: readonly PointClusterLayerWitness[] }>();
const acknowledgedProps = new WeakMap<object, Provenance>();
let sequence = 0;

export function recordMaonoDeckRenderInputs(props: DeckProps, sourceState: any) {
  consumedInputs.set(props, { inputs: mapCaptureRenderInputs(sourceState), clusterWitnesses: pointClusterLayerWitnesses(props.layers, sourceState) });
}

/** Kepler invokes this only from Deck's real onAfterRender callback, with the
 * props captured in that exact render closure (including the layer array). */
export function acknowledgeMaonoDeckRender(props: DeckProps) {
  const consumed = consumedInputs.get(props);
  if (!consumed || !props.layers || typeof props.layers !== "object") return;
  acknowledgedProps.set(props.layers, { ...consumed, clusterWitnesses: acknowledgePointClusterWitnesses(consumed.clusterWitnesses), layers: props.layers, sequence: ++sequence });
}

export function maonoDeckGenerationAcknowledgment(layers: unknown, expectedInputs: unknown[], expectedClusters: PointClusterCaptureExpectation, viewIndex = 0) {
  if (!layers || typeof layers !== "object") return null;
  const ack = acknowledgedProps.get(layers);
  if (!ack || ack.inputs.length !== expectedInputs.length || ack.inputs.some((value, index) => value !== expectedInputs[index])) return null;
  if (!pointClusterWitnessesMatch(ack.clusterWitnesses, expectedClusters, viewIndex)) return null;
  return ack;
}

const STYLE_CAPTURE_TOKEN = "maono:preview-style-generation";
const EMPTY_STYLE = Object.freeze({ version: 8, sources: {}, layers: [] });
const taggedStyles = new WeakMap<object, { style: any; token: string; identity: string }>();
const semanticStyles = new Map<string, string>();
let styleSequence = 0;
function styleIdentity(style: any) {
  const { metadata: _metadata, ...visualStyle } = style;
  void _metadata;
  return JSON.stringify(visualStyle, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

/** Metadata-only edits are ignored by MapLibre's style diff. Semantically equal
 * visual styles MUST share the same token, including replacement objects. */
export function taggedCaptureMapStyle(value: unknown) {
  const style = value == null ? EMPTY_STYLE : value;
  if (!style || typeof style !== "object" || Array.isArray(style)) return null;
  const existing = taggedStyles.get(style);
  if (existing) { semanticStyles.set(existing.identity, existing.token); return existing; }
  const identity = styleIdentity(style);
  let token = semanticStyles.get(identity);
  if (!token) { token = `capture-style-${++styleSequence}`; semanticStyles.set(identity, token); }
  const tagged = { style: { ...style, metadata: { ...(style as any).metadata, [STYLE_CAPTURE_TOKEN]: token } }, token, identity };
  taggedStyles.set(style, tagged);
  return tagged;
}

export type CaptureStyleExpectation = { bottom: string; top: string | null };
export function captureStyleExpectation(mapStyle: any): CaptureStyleExpectation {
  const bottom = taggedCaptureMapStyle(mapStyle?.bottomMapStyle);
  const top = mapStyle?.topMapStyle ? taggedCaptureMapStyle(mapStyle.topMapStyle) : null;
  if (!bottom || (mapStyle?.topMapStyle && !top)) throw new Error("CAPTURE_STYLE_IDENTITY_UNAVAILABLE");
  return { bottom: bottom.token, top: top?.token || null };
}


export type CaptureCamera = Record<string, number>;
export type CaptureView = { index: number; camera: CaptureCamera };
export function captureViews(mapState: any): CaptureView[] {
  const normalize = (value: any) => Object.fromEntries(["longitude", "latitude", "zoom", "pitch", "bearing"].map(key => [key, Number(value?.[key] ?? (["pitch", "bearing"].includes(key) ? 0 : NaN))]));
  if (!mapState?.isSplit) return [{ index: 0, camera: normalize(mapState) }];
  return [0, 1].map(index => ({ index, camera: normalize(!mapState.isViewportSynced && mapState.splitMapViewports?.length > 1 ? { ...mapState, ...mapState.splitMapViewports[index] } : mapState) }));
}
export function captureCameraMatches(actual: Record<string, unknown>, expected: CaptureCamera) {
  const keys = ["longitude", "latitude", "zoom", "pitch", "bearing"];
  if (keys.some(key => !Number.isFinite(Number(actual[key])) || !Number.isFinite(expected[key]))) return false;
  const wrappedDelta = (left: number, right: number) => {
    const delta = Math.abs((left - right) % 360);
    return Math.min(delta, 360 - delta);
  };
  // Geographic tolerance alone grows into many stale pixels at high zoom.
  // Permit at most one thousandth of a 512px Mercator world pixel, with a
  // small angular cap at low zoom. Latitude is scaled by the Mercator slope.
  const worldPixels = 512 * Math.pow(2, Math.max(0, expected.zoom));
  const longitudeTolerance = Math.min(1e-7, 360 * 0.001 / worldPixels);
  const latitudeTolerance = longitudeTolerance * Math.max(1e-12, Math.abs(Math.cos(expected.latitude * Math.PI / 180)));
  return wrappedDelta(Number(actual.longitude), expected.longitude) <= longitudeTolerance
    && Math.abs(Number(actual.latitude) - expected.latitude) <= latitudeTolerance
    && Math.abs(Number(actual.zoom) - expected.zoom) <= 1e-9
    && Math.abs(Number(actual.pitch) - expected.pitch) <= 1e-9
    && wrappedDelta(Number(actual.bearing), expected.bearing) <= 1e-9;
}

export type CaptureStyleRuntime = { style?: { stylesheet?: { metadata?: Record<string, unknown> } }; getCanvas?: () => HTMLCanvasElement; getStyle?: () => { metadata?: Record<string, unknown> }; isStyleLoaded?: () => boolean; areTilesLoaded?: () => boolean; isMoving?: () => boolean; getCenter?: () => { lng: number; lat: number }; getZoom?: () => number; getPitch?: () => number; getBearing?: () => number; on?: (event: string, callback: () => void) => void; off?: (event: string, callback: () => void) => void; triggerRepaint?: () => void };
type StyleEntry = { role: "bottom" | "top"; index: number; map: CaptureStyleRuntime; rendered: { token: unknown; camera: Record<string, unknown> } | null };
const styleRuntimes = new Set<StyleEntry>();
function runtimeCamera(map: CaptureStyleRuntime) {
  const center = map.getCenter?.();
  return { longitude: center?.lng, latitude: center?.lat, zoom: map.getZoom?.(), pitch: map.getPitch?.(), bearing: map.getBearing?.() };
}
function renderedStyleToken(map: CaptureStyleRuntime) {
  // Both pinned MapLibre/Mapbox versions retain the applied stylesheet here.
  // Reading its metadata avoids getStyle(), which serializes every layer and
  // source on each render. Other compatible adapters use the public fallback.
  const stylesheet = map.style?.stylesheet;
  return stylesheet ? stylesheet.metadata?.[STYLE_CAPTURE_TOKEN] : map.getStyle?.()?.metadata?.[STYLE_CAPTURE_TOKEN];
}

function styleLoaded(map: CaptureStyleRuntime) {
  const canvas = map.getCanvas?.();
  const gl = canvas?.getContext?.("webgl2") || canvas?.getContext?.("webgl");
  return !gl?.isContextLost() && map.isStyleLoaded?.() === true && map.areTilesLoaded?.() === true && !map.isMoving?.();
}
export function registerMaonoCaptureStyleRuntime(role: "bottom" | "top", value: unknown, index = 0) {
  if (!value || typeof value !== "object") return () => undefined;
  const map = value as CaptureStyleRuntime;
  const entry: StyleEntry = { role, index, map, rendered: null };
  const onRender = () => {
    entry.rendered = styleLoaded(map) ? { token: renderedStyleToken(map), camera: runtimeCamera(map) } : null;
  };
  styleRuntimes.add(entry);
  map.on?.("render", onRender);
  map.triggerRepaint?.();
  return () => { map.off?.("render", onRender); styleRuntimes.delete(entry); if (!styleRuntimes.size) semanticStyles.clear(); };
}
export function maonoCaptureStyleRuntimes(root: HTMLElement) {
  return [...styleRuntimes].filter(entry => { const canvas = entry.map.getCanvas?.(); return canvas && root.contains(canvas); });
}

/** Style application and tile readiness can precede drawing. Require a real
 * rendered style/camera snapshot for every bottom/top surface of each viewport. */
export function maonoCaptureStylesReady(root: HTMLElement, expected: CaptureStyleExpectation, views: CaptureView[]) {
  const entries = maonoCaptureStyleRuntimes(root);
  if (entries.length !== views.length * (expected.top ? 2 : 1)) return false;
  return views.every(view => {
    const scoped = entries.filter(entry => entry.index === view.index);
    if (scoped.filter(entry => entry.role === "bottom").length !== 1 || scoped.filter(entry => entry.role === "top").length !== (expected.top ? 1 : 0)) return false;
    return scoped.every(({ map, role, rendered }) => Boolean(rendered && rendered.token === expected[role]
      && renderedStyleToken(map) === expected[role] && styleLoaded(map)
      && captureCameraMatches(runtimeCamera(map), view.camera) && captureCameraMatches(rendered.camera, view.camera)));
  });
}

export type CaptureDeckRuntime = { canvas?: HTMLCanvasElement; gl?: { canvas?: HTMLCanvasElement; isContextLost?: () => boolean }; props?: { layers?: unknown }; isInitialized?: boolean; layerManager?: { getLayers?: () => { isLoaded?: boolean; props?: { visible?: boolean } }[]; needsUpdate?: () => unknown }; getViewports?: () => Record<string, number>[]; redraw?: (reason?: string | boolean) => void };
const deckRuntimes = new Set<{ index: number; deck: CaptureDeckRuntime }>();
export function registerMaonoCaptureDeckRuntime(value: unknown, index = 0) {
  if (!value || typeof value !== "object") return () => undefined;
  const entry = { index, deck: value as CaptureDeckRuntime }; deckRuntimes.add(entry);
  return () => { deckRuntimes.delete(entry); };
}
export function maonoCaptureDeckRuntimes(root: HTMLElement) {
  return [...deckRuntimes].filter(({ deck }) => { const canvas = deck.canvas || deck.gl?.canvas; return canvas && root.contains(canvas); });
}
