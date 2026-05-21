import { useEffect } from "react";

/** タブ非表示時に全 CSS アニメを停止 */
export function useTabAnimationsPaused() {
  useEffect(() => {
    const sync = () => {
      document.documentElement.classList.toggle("tab-animations-paused", document.hidden);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
}
