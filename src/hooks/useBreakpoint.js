import { useState, useEffect } from "react";
const BREAKPOINTS = { mobile: 480, tablet: 768 };
export function useBreakpoint() {
  const get = () =>
    window.innerWidth < BREAKPOINTS.mobile ? "mobile"
    : window.innerWidth < BREAKPOINTS.tablet ? "tablet"
    : "desktop";
  const [bp, setBp] = useState(get);
  useEffect(() => {
    const mql = [
      window.matchMedia(`(max-width: ${BREAKPOINTS.mobile - 1}px)`),
      window.matchMedia(`(max-width: ${BREAKPOINTS.tablet - 1}px)`),
    ];
    const handler = () => setBp(get);
    mql.forEach((m) => m.addEventListener("change", handler));
    return () => mql.forEach((m) => m.removeEventListener("change", handler));
  }, []);
  return bp; // "desktop" | "tablet" | "mobile"
}
