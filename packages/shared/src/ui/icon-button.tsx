import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from "react";

export const iconButtonClass =
  "inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

function joinClasses(...values: Array<string | undefined | false | null>) {
  return values.filter(Boolean).join(" ");
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, ...props }, ref) {
    return (
      <button
        type="button"
        {...props}
        ref={ref}
        className={joinClasses(iconButtonClass, className)}
      />
    );
  },
);

export type IconLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;

export const IconLink = forwardRef<HTMLAnchorElement, IconLinkProps>(
  function IconLink({ className, ...props }, ref) {
    return (
      <a
        ref={ref}
        className={joinClasses(iconButtonClass, className)}
        {...props}
      />
    );
  },
);
