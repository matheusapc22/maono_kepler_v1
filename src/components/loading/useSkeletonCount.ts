import { useEffect, useState, type RefObject } from "react";
import { estimateSkeletonCount, type SkeletonCountOptions } from "./region-loading-policy";

function readViewport() {
  return typeof window === "undefined"
    ? { viewportHeight: 768, viewportWidth: 1280 }
    : { viewportHeight: window.innerHeight, viewportWidth: window.innerWidth };
}

/** Resize only changes reserved placeholder count, never request state. */
export function useSkeletonCount(options: SkeletonCountOptions = {}, regionRef?: RefObject<HTMLElement | null>) {
  const [viewport, setViewport] = useState(readViewport);
  const [region, setRegion] = useState<{ viewportWidth: number; columns?: number } | null>(null);
  const grid = options.layout === "grid";
  useEffect(() => {
    const update = () => {
      const next = readViewport();
      setViewport(current => current.viewportHeight === next.viewportHeight && current.viewportWidth === next.viewportWidth ? current : next);
      const element = regionRef?.current;
      if (element) {
        const width = element.getBoundingClientRect().width;
        const template = grid ? window.getComputedStyle(element).gridTemplateColumns : "none";
        const columns = template !== "none" ? template.split(/\s+/).filter(Boolean).length : undefined;
        if (width > 0) setRegion(current => current?.viewportWidth === width && current.columns === columns ? current : { viewportWidth: width, columns });
      }
    };
    window.addEventListener("resize", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" && regionRef?.current ? new ResizeObserver(update) : null;
    if (observer && regionRef?.current) observer.observe(regionRef.current);
    update();
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [regionRef, grid]);
  return estimateSkeletonCount({ ...viewport, ...options, ...region });
}
