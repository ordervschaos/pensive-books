import { defineConfig } from "vite";
import reactSwc from "@vitejs/plugin-react-swc";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
import componentTaggerPlugin from "@ordervschaos/babel-plugin-react-component-tagger";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { streamProseDevPlugin } from "./vite-plugin-stream-prose";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
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
    mode === 'development' && streamProseDevPlugin(),
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