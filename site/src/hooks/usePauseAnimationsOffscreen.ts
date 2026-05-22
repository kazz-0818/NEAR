import { useEffect, type RefObject } from "react";

/** 画面外のセクションでは CSS アニメを止めて GPU 負荷を下げる */
export function usePauseAnimationsOffscreen(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        el.classList.toggle("animations-paused", !entry.isIntersecting);
      },
      { rootMargin: "200px 0px", threshold: 0.05 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}
