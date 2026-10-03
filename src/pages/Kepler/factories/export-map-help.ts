import { ExportHtmlMapFactory, ExportJsonMapFactory } from '@kepler.gl/components';
import ExportHtmlMapWithoutExternalHelp from '../components/export-map-modal/export-html-map';
import ExportJsonMapWithoutExternalHelp from '../components/export-map-modal/export-json-map';

// Use Kepler's supported factory seams. Controls, state and export callbacks
// remain native-compatible; only external documentation navigation is absent.
export function replaceExportHtmlMap() {
  return [ExportHtmlMapFactory, ExportHtmlMapWithoutExternalHelp];
}

export function replaceExportJsonMap() {
  return [ExportJsonMapFactory, ExportJsonMapWithoutExternalHelp];
}
