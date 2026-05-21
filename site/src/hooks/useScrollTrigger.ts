import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "./useReducedMotion";

gsap.registerPlugin(ScrollTrigger);

/** Lenis なしのネイティブスクロール + ScrollTrigger のみ */
export function useScrollTrigger() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;

    const onRefresh = () => ScrollTrigger.refresh();
    window.addEventListener("resize", onRefresh);

    return () => {
      window.removeEventListener("resize", onRefresh);
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, [reduced]);
}
