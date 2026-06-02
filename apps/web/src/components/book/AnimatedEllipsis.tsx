import { useState, useEffect } from "react";

/** Cycles through ".", "..", "..." to signal an in-progress operation. */
export function AnimatedEllipsis() {
  const [dots, setDots] = useState(1);
  useEffect(() => {
    const id = setInterval(() => setDots((d) => (d < 3 ? d + 1 : 1)), 400);
    return () => clearInterval(id);
  }, []);
  return <span aria-hidden>{"·".repeat(dots)}</span>;
}
