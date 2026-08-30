import { useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { mapStyleChange, wrapTo } from "@kepler.gl/actions";

import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry";
import { useMapPanel } from "../map-panel/MapPanelContext";
import {
  KEPLER_MAP_ID,
  readValue,
  selectKeplerMapState,
} from "./selectors";
import type { KeplerCommandResult } from "./types";

export type MaonoBasemapStyleOption = {
  id: string;
  label: string;
  selected: boolean;
  source: "default" | "custom";
};

export type MaonoBasemapController = {
  available: boolean;
  loading: boolean;
  currentStyleId: string | null;
  styles: MaonoBasemapStyleOption[];
  selectStyle: (styleId: string) => KeplerCommandResult;
};

const DEFAULT_STYLE_ORDER = ["light", "muted", "dark", "muted_night"];
const DEFAULT_STYLE_LABELS: Record<string, string> = {
  light: "Claro",
  muted: "Suave",
  dark: "Escuro",
  muted_night: "Noturno suave",
};

function entries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== "object") return [];

  if (
    typeof (
      value as {
        entrySeq?: () => { toArray: () => Array<[string, unknown]> };
      }
    ).entrySeq === "function"
  ) {
    return (
      value as {
        entrySeq: () => { toArray: () => Array<[string, unknown]> };
      }
    )
      .entrySeq()
      .toArray();
  }

  if (value instanceof Map) {
    return Array.from(value.entries());
  }

  return Object.entries(value as Record<string, unknown>);
}

function titleFromId(styleId: string) {
  return styleId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function styleLabel(styleId: string, style: unknown) {
  const configured = String(
    readValue(style, "label") ?? readValue(style, "name") ?? "",
  ).trim();

  return configured || DEFAULT_STYLE_LABELS[styleId] || titleFromId(styleId);
}

function normalizeStyles(mapState: unknown): MaonoBasemapStyleOption[] {
  const mapStyle = readValue(mapState, "mapStyle");
  const currentStyleId = String(
    readValue(mapStyle, "styleType") ?? "",
  ).trim();
  const rawStyles = readValue(mapStyle, "mapStyles");

  return entries(rawStyles)
    .map(([key, style]) => {
      const id = String(readValue(style, "id") ?? key).trim();
      if (!id) return null;

      return {
        id,
        label: styleLabel(id, style),
        selected: id === currentStyleId,
        source: DEFAULT_STYLE_ORDER.includes(id)
          ? ("default" as const)
          : ("custom" as const),
      };
    })
    .filter((style): style is MaonoBasemapStyleOption => Boolean(style))
    .sort((left, right) => {
      const leftDefault = DEFAULT_STYLE_ORDER.indexOf(left.id);
      const rightDefault = DEFAULT_STYLE_ORDER.indexOf(right.id);

      if (leftDefault !== -1 || rightDefault !== -1) {
        if (leftDefault === -1) return 1;
        if (rightDefault === -1) return -1;
        return leftDefault - rightDefault;
      }

      return left.label.localeCompare(right.label, "pt-BR");
    });
}

export function useMaonoBasemapController(): MaonoBasemapController {
  const dispatch = useDispatch();
  const mapState = useSelector(selectKeplerMapState);
  const { context } = useMapPanel();
  const styles = useMemo(() => normalizeStyles(mapState), [mapState]);
  const mapStyle = readValue(mapState, "mapStyle");
  const currentStyleId =
    String(readValue(mapStyle, "styleType") ?? "").trim() || null;
  const available = context?.capabilities.viewMap === true;
  const loading = Boolean(available && mapState && styles.length === 0);

  const selectStyle = useCallback(
    (styleId: string): KeplerCommandResult => {
      const normalized = String(styleId ?? "").trim();

      if (!context?.capabilities.viewMap) {
        return {
          ok: false,
          code: "CAPABILITY_DENIED",
          reason:
            "Você não possui acesso para alterar a visualização do mapa-base.",
          command: "setBasemapStyle",
          capability: "viewMap",
        };
      }

      if (!normalized) {
        return {
          ok: false,
          code: "COMMAND_INVALID",
          reason: "Selecione um estilo de mapa-base válido.",
          command: "setBasemapStyle",
        };
      }

      const selected = styles.find((style) => style.id === normalized);
      if (!selected) {
        return {
          ok: false,
          code: "COMMAND_INVALID",
          reason: "Este estilo de mapa-base não está disponível neste mapa.",
          command: "setBasemapStyle",
        };
      }

      if (currentStyleId === normalized) {
        return {
          ok: true,
          changed: false,
        };
      }

      try {
        dispatch(wrapTo(KEPLER_MAP_ID, mapStyleChange(normalized)));
        emitMapPanelTelemetry("basemap_style_changed", {
          mode: context.mode,
          projectId: context.project?.id ?? null,
          organizationId: context.organization?.id ?? null,
          styleId: normalized,
          persistence: context.capabilities.saveMap ? "project" : "session",
          source: "maono-basemap-controller-v1",
        });

        return {
          ok: true,
          changed: true,
        };
      } catch {
        return {
          ok: false,
          code: "COMMAND_FAILED",
          reason: "Não foi possível alterar o mapa-base agora.",
          command: "setBasemapStyle",
          capability: "viewMap",
        };
      }
    },
    [context, currentStyleId, dispatch, styles],
  );

  return {
    available,
    loading,
    currentStyleId,
    styles,
    selectStyle,
  };
}
