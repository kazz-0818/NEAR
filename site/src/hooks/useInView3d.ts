import { useEffect, useState, type RefObject } from "react";
import { useReducedMotion } from "./useReducedMotion";

/** 3D 背景: モバイル・ reduced-motion ではオフ、画面内のみマウント */
export function useInView3d(ref: RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (reduced) {
      setEnabled(false);
      return;
    }

    const narrow = window.matchMedia("(max-width: 768px)");
    const el = ref.current;
    if (!el || narrow.matches) {
      setEnabled(false);
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => setEnabled(entry.isIntersecting),
      { rootMargin: "160px 0px", threshold: 0.05 },
    );

    io.observe(el);
    const onResize = () => setEnabled((prev) => prev && !narrow.matches);
    narrow.addEventListener("change", onResize);

    return () => {
      io.disconnect();
      narrow.removeEventListener("change", onResize);
    };
  }, [ref, reduced]);

  return enabled;
}
