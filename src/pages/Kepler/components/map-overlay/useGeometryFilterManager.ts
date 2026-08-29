// O gestor de Polygon Filter deixou de depender do Editor/FeatureActionPanel do
// Kepler. A gestão agora acontece dentro do tooltip Maõno, que controla as
// associações de layers explicitamente. Mantemos o hook como no-op temporário
// para preservar compatibilidade com o runtime enquanto a chamada antiga é
// removida em uma limpeza posterior.
export function useGeometryFilterManager() {
  return undefined;
}
