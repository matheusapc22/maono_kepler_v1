# Maono

This is the official repository for the Maono maps platform. Its simply a clone of the [kepler.gl](https://github.com/keplergl/kepler.gl) project with some modifications to make it work with Maono's specific requirements.
The files were converted to typescript files, but are not fully converted yet. The (@ts-ignore) comments are used to ignore errors that are TS related for now.

### Modifications

Most modifications are made through the use of factories or class selectors in **index.css**.

## Rollback funcional do runtime Maono/Kepler

A baseline estabilizada preserva `MapPanelProvider`, `MapPanelAccessGate`,
salvamento, preview, clustering e `MapUrlLoader`, mas não monta
`replaceSidePanel`, `MaonoMapShell` ou `MapOverlayControls`. Os arquivos
customizados permanecem no repositório como referência para a futura
reintrodução por meio do Engine Adapter v2.

As integrações customizadas são opt-in. No frontend, somente o valor literal
`true` habilita uma flag:

| Flag frontend | Default |
| --- | --- |
| `VITE_MAONO_LAYER_MANAGER_V1` | `false` |
| `VITE_MAONO_MAP_SHELL_V1` | `false` |
| `VITE_MAONO_MAP_OVERLAY_V1` | `false` |

As flags correspondentes do backend
(`MAONO_LAYER_MANAGER_V1`, `MAONO_MAP_SHELL_V1`,
`MAONO_MAP_OVERLAY_V1` e `MAONO_ISOCHRONE_V1`) também permanecem
desligadas por padrão. Enquanto os pontos de montagem estiverem fora do
runtime, alterar apenas as flags não reintroduz a UI anterior.

Este rollback não remove endpoints, auditoria ou migrations e não exige
alteração no D1.
