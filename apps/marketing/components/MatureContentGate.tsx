"use client";

import { useEffect, useState, type ReactNode } from "react";
import { EyeOff } from "lucide-react";

const LOCAL_KEY = "mature_content_enabled";

interface Props {
  children: ReactNode;
  bookName?: string;
}

export function MatureContentGate({ children, bookName }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUnlocked(localStorage.getItem(LOCAL_KEY) === "true");
    setReady(true);
  }, []);

  if (!ready) {
    // Render nothing until we've read localStorage, so we don't flash gated
    // content for users who already opted in.
    return null;
  }

  if (unlocked) {
    return <>{children}</>;
  }

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-[560px] flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-[hsl(var(--pv-surface-2))]">
        <EyeOff className="h-6 w-6 text-[hsl(var(--pv-text-muted))]" />
      </div>
      <h2 className="pv-display text-[32px] font-normal italic leading-none tracking-tight text-foreground">
        Mature content
      </h2>
      <p className="pv-serif mt-4 text-[15px] italic leading-relaxed text-[hsl(var(--pv-text-muted))]">
        {bookName ? (
          <>
            <em>{bookName}</em> contains content intended for readers 18 and older.
          </>
        ) : (
          <>This work contains content intended for readers 18 and older.</>
        )}
      </p>
      <button
        type="button"
        onClick={() => {
          localStorage.setItem(LOCAL_KEY, "true");
          setUnlocked(true);
        }}
        className="pv-serif mt-8 inline-flex items-center justify-center rounded-full bg-foreground px-7 py-3 text-[14px] tracking-[0.01em] text-background transition-colors hover:opacity-90"
      >
        I am 18 or older — continue
      </button>
      <p className="mt-3 max-w-xs text-[11px] text-[hsl(var(--pv-text-faint))]">
        This preference is saved on this device.
      </p>
    </main>
  );
}
