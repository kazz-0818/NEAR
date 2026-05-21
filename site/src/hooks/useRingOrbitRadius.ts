import { useEffect, useState, type RefObject } from "react";

const STROKE_HALF = 2.5;

/** 虹色リングの線の中央を通る軌道半径（px） */
export function useRingOrbitRadius(ringRef: RefObject<HTMLElement | null>) {
  const [radiusPx, setRadiusPx] = useState(130);

  useEffect(() => {
    const el = ringRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.getBoundingClientRect().width;
      setRadiusPx(Math.max(72, w / 2 - STROKE_HALF));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ringRef]);

  return radiusPx;
}
