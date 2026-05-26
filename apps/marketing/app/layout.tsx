import type { Metadata } from "next";
import "./globals.css";
import { PublicTopNav } from "@/components/PublicTopNav";
import { CookieBanner } from "@/components/CookieBanner";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { VercelAnalytics } from "@/components/VercelAnalytics";

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
  return (
    <html lang="en" className="theme-paper light" suppressHydrationWarning>
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
                var valid = ["paper", "coffee", "pumpkin"];
                var raw = getCookie("themeName") || localStorage.getItem("themeName") || "paper";
                var themeName = valid.indexOf(raw) >= 0 ? raw : "paper";
                var storedMode = getCookie("themeMode") || localStorage.getItem("themeMode");
                var themeMode = storedMode || (themeName === "paper" ? "light" : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));

                root.classList.remove("light", "dark", "theme-default", "theme-paper", "theme-coffee", "theme-mujiyish", "theme-pumpkin");
                root.classList.add("theme-" + themeName);
                root.classList.add(themeMode);
              })();
            `,
          }}
        />
        <PublicTopNav />
        {children}
        <CookieBanner />
        <GoogleAnalytics />
        <VercelAnalytics />
      </body>
    </html>
  );
}
