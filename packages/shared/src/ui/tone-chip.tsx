import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../lib/cn";

// ToneChip — a multi-select pill toggle (the signature "tone" control in the
// brief/voice surfaces). `selected` fills it with --primary; off is a quiet
// outline. Serif, matching the DS forms specimen (.chip).
export interface ToneChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export const ToneChip = forwardRef<HTMLButtonElement, ToneChipProps>(
  function ToneChip({ className, selected = false, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={selected}
        className={cn(
          "pv-serif inline-flex items-center justify-center rounded-full border px-[18px] py-[9px] text-[15.5px] leading-none transition-colors disabled:pointer-events-none disabled:opacity-50",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-foreground hover:border-foreground/40",
          className,
        )}
        {...props}
      />
    );
  },
);
