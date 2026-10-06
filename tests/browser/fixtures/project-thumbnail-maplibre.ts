import maplibregl from 'maplibre-gl';
import { taggedCaptureMapStyle } from '../../../src/pages/Kepler/thumbnail/capture-render-generation';

export async function verifyActualStyleTokens() {
  document.body.innerHTML = '<div id="map" style="width:640px;height:360px"></div>';
  const style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ddeeff' } }] };
  const tagged = taggedCaptureMapStyle(style)!;
  let map: maplibregl.Map;
  try { map = new maplibregl.Map({ container: 'map', style: tagged.style, center: [0, 0], zoom: 2, preserveDrawingBuffer: true, attributionControl: false }); }
  catch (error) { return { unavailable: String(error) }; }
  const frame = () => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { map.off('render', check); reject(new Error('REAL_MAP_RENDER_TIMEOUT')); }, 4000);
    const check = () => { if (map.isStyleLoaded() && map.areTilesLoaded()) { clearTimeout(timeout); map.off('render', check); resolve(); } };
    map.on('render', check); map.triggerRepaint();
  });
  try {
    await frame();
    const initial = map.getStyle().metadata?.['maono:preview-style-generation'];
    const replacement = taggedCaptureMapStyle({ layers: style.layers, sources: {}, metadata: { updated: true }, version: 8 })!;
    map.setStyle(replacement.style); await frame();
    const unchanged = map.getStyle().metadata?.['maono:preview-style-generation'];
    const changed = taggedCaptureMapStyle({ ...style, layers: [{ ...style.layers[0], paint: { 'background-color': '#000022' } }] })!;
    map.setStyle(changed.style); await frame();
    const actualChanged = map.getStyle().metadata?.['maono:preview-style-generation'];
    return { initial, initialExpected: tagged.token, unchanged, unchangedExpected: replacement.token, changed: actualChanged, changedExpected: changed.token };
  } finally { map.remove(); }
}
