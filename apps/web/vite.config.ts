import { defineConfig } from "vite";
import reactSwc from "@vitejs/plugin-react-swc";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
import componentTaggerPlugin from "@ordervschaos/babel-plugin-react-component-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    // MDX compiles .mdx -> plain JS (its own JSX->_jsx() transform, no raw JSX left), so it must run
    // BEFORE the React plugins below and doesn't fight either of them (dev: babel, prod: swc). Docs
    // author content as .mdx (see apps/web/src/pages/docs/registry.ts); remark-gfm matches the
    // GFM support the old react-markdown renderer had (tables, strikethrough, task lists).
    mdx({ remarkPlugins: [remarkGfm], providerImportSource: "@mdx-js/react" }),
    // Use regular React plugin in development for Babel plugin support
    // Use react-swc in production for better performance
    mode === 'development'
      ? react({
          babel: {
            plugins: [componentTaggerPlugin],
          },
        })
      : reactSwc(),
    mode === 'development' &&
    componentTagger(),
    ...(mode === 'production' && process.env.SENTRY_AUTH_TOKEN
      ? [sentryVitePlugin({
          org: "o4508145966514176",
          project: "4508145967431680",
          authToken: process.env.SENTRY_AUTH_TOKEN,
        })]
      : []),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
}));