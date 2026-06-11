import { type HTMLAttributes } from "react";

import { cn } from "../lib/cn";

// The fixed resolution-state vocabulary. Every ladder artifact is exactly one
// of these — don't invent new statuses (DS non-negotiable #6).
//   in sync     → solid --accent pip
//   out of sync → amber pip (the one DS-sanctioned literal)
//   empty       → 1.5px ring on --border
export type ResolutionState = "sync" | "out-of-sync" | "empty";

const pipClass: Record<ResolutionState, string> = {
  sync: "bg-accent",
  "out-of-sync": "bg-[hsl(38_80%_50%)]",
  empty: "border-[1.5px] border-border bg-transparent",
};

export interface PipProps extends HTMLAttributes<HTMLSpanElement> {
  state?: ResolutionState;
}

export function Pip({ className, state = "empty", ...props }: PipProps) {
  return (
    <span
      className={cn("inline-block h-[9px] w-[9px] shrink-0 rounded-full", pipClass[state], className)}
      {...props}
    />
  );
}

// A node card on the resolution map. `empty` switches to a dashed, transparent
// frame whose copy should invite generation rather than apologize for blankness.
export interface ResolutionNodeProps extends HTMLAttributes<HTMLDivElement> {
  empty?: boolean;
}

export function ResolutionNode({ className, empty = false, ...props }: ResolutionNodeProps) {
  return (
    <div
      className={cn(
        "rounded-lg px-[18px] py-[16px]",
        empty
          ? "border border-dashed border-border/70 bg-transparent"
          : "border border-border bg-card",
        className,
      )}
      {...props}
    />
  );
}
