import { useEffect, type RefObject } from "react";
import { useReducedMotion } from "./useReducedMotion";

type RevealOptions = {
  once?: boolean;
  threshold?: number;
  rootMargin?: string;
};

/** 画面に入ったら `is-visible` を付与（GSAP ScrollTrigger の代替） */
export function useRevealOnScroll<T extends HTMLElement>(
  ref: RefObject<T | null>,
  options: RevealOptions = {},
) {
  const reduced = useReducedMotion();
  const { once = true, threshold = 0.1, rootMargin = "0px 0px -8% 0px" } = options;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (reduced) {
      el.classList.add("is-visible");
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          if (once) io.disconnect();
        } else if (!once) {
          el.classList.remove("is-visible");
        }
      },
      { threshold, rootMargin },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [ref, reduced, once, threshold, rootMargin]);
}
