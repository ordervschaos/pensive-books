import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../lib/cn";

// Eyebrow — the small mono, wide-tracked uppercase label that sits above a
// title or section. Mono is structural here (DS non-negotiable #1); never use
// it for reading. Uses --muted-foreground so it reads on every theme (the
// Paper-only --pv-text-faint isn't defined elsewhere).
export type EyebrowProps = HTMLAttributes<HTMLSpanElement>;

export const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(
  function Eyebrow({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn(
          "pv-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground",
          className,
        )}
        {...props}
      />
    );
  },
);
