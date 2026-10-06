import { subscribePointClusterStore, getPointClusterSnapshot } from "../clustering/point-cluster-store.ts";
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { MapContainerFactory } from "@kepler.gl/components";
import { acknowledgeMaonoDeckRender, recordMaonoDeckRenderInputs, registerMaonoCaptureStyleRuntime, registerMaonoCaptureDeckRuntime, taggedCaptureMapStyle } from "../thumbnail/capture-render-generation";

CaptureMapContainerFactory.deps = MapContainerFactory.deps;
// Kepler dependency injection exports a factory, not a hot-reloadable component.
// eslint-disable-next-line react-refresh/only-export-components
function CaptureMapContainerFactory(...deps: Parameters<typeof MapContainerFactory>) {
  const MapContainer = MapContainerFactory(...deps);
  function CaptureMapContainer(props: React.ComponentProps<typeof MapContainer>) {
    // A same-zoom Redux update can be memoized away. Subscribe at the actual
    // MapContainer boundary so external policy changes construct new layers.
    // This requests work only; provenance still comes from produced layers.
    useSyncExternalStore(subscribePointClusterStore, getPointClusterSnapshot, getPointClusterSnapshot);
    const latestProps = useRef(props);
    latestProps.current = props;
    const release = useRef({ bottom: () => {}, top: () => {}, deck: () => {} });
    useEffect(() => () => { release.current.bottom(); release.current.top(); release.current.deck(); }, []);
    const bottomRef = useCallback((ref: any, index?: number) => {
      release.current.bottom();
      release.current.bottom = registerMaonoCaptureStyleRuntime("bottom", ref?.getMap?.(), latestProps.current.index || 0);
      latestProps.current.getMapboxRef?.(ref, index);
    }, []);
    const topRef = useCallback((ref: any) => {
      release.current.top();
      release.current.top = registerMaonoCaptureStyleRuntime("top", ref?.getMap?.(), latestProps.current.index || 0);
      const existing = latestProps.current.topMapContainerProps?.ref;
      if (typeof existing === "function") existing(ref);
      else if (existing) existing.current = ref;
    }, []);
    const deckInitialized = useCallback((deck: any, gl: any) => {
      release.current.deck(); release.current.deck = registerMaonoCaptureDeckRuntime(deck, latestProps.current.index || 0);
      latestProps.current.onDeckInitialized?.(deck, gl);
    }, []);
    const bottom = taggedCaptureMapStyle(props.bottomMapContainerProps?.mapStyle ?? props.mapStyle.bottomMapStyle);
    const top = props.mapStyle.topMapStyle ? taggedCaptureMapStyle(props.topMapContainerProps?.mapStyle ?? props.mapStyle.topMapStyle) : null;
    const original = props.deckRenderCallbacks;
    const deckRenderCallbacks = {
      ...original,
      onDeckRender(deckProps: Record<string, unknown>) {
        const result = original?.onDeckRender ? original.onDeckRender(deckProps) : deckProps;
        if (result) recordMaonoDeckRenderInputs(result, props);
        return result;
      },
      onDeckAfterRender(deckProps: Record<string, unknown>) {
        original?.onDeckAfterRender?.(deckProps);
        acknowledgeMaonoDeckRender(deckProps);
      },
    };
    return <MapContainer {...props} deckRenderCallbacks={deckRenderCallbacks} getMapboxRef={bottomRef} onDeckInitialized={deckInitialized}
      bottomMapContainerProps={{ ...props.bottomMapContainerProps, ...(bottom ? { mapStyle: bottom.style } : {}) }}
      topMapContainerProps={{ ...props.topMapContainerProps, ...(top ? { mapStyle: top.style } : {}), ref: topRef }} />;
  }
  CaptureMapContainer.displayName = "MaonoCaptureRenderGeneration";
  return CaptureMapContainer;
}

export function replaceCaptureMapContainer() {
  return [MapContainerFactory, CaptureMapContainerFactory];
}
