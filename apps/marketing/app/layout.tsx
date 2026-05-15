import type { Metadata } from "next";
import "./globals.css";
import { PublicTopNav } from "@/components/PublicTopNav";
import { LibraryNavTabs } from "@/components/LibraryNavTabs";
import { getConfiguredAppOrigin } from "@/lib/pensive";

const publicOrigin =
  process.env.PENSIVE_PUBLIC_ORIGIN ??
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : "https://pensive.me");

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin),
  title: "Pensive",
  description: "Public-facing Next.js app for Pensive's landing, library, and profile pages.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const appOrigin = getConfiguredAppOrigin();

  return (
    <html lang="en" className="theme-coffee dark" suppressHydrationWarning>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function getCookie(n) {
                  var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)"));
                  return m ? decodeURIComponent(m[1]) : null;
                }
                var root = document.documentElement;
                var themeName = getCookie("themeName") || localStorage.getItem("themeName") || "coffee";
                var storedMode = getCookie("themeMode") || localStorage.getItem("themeMode");
                var themeMode = storedMode || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

                root.classList.remove("light", "dark", "theme-default", "theme-coffee", "theme-mujiyish", "theme-pumpkin");
                if (themeName !== "default") root.classList.add("theme-" + themeName);
                root.classList.add(themeMode);
              })();
            `,
          }}
        />
        <PublicTopNav />
        <LibraryNavTabs appOrigin={appOrigin} />
        {children}
      </body>
    </html>
  );
}
