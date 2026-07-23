/// <reference types="vite/client" />

// Each docs .mdx file's default export is the compiled MDX component (see
// apps/web/src/pages/docs/registry.ts). @mdx-js/rollup's providerImportSource wiring means it reads
// its `components` map from MDXProvider context rather than a prop, so this is the same shape as any
// other function component.
declare module "*.mdx" {
  import type { ComponentType } from "react";
  const MDXComponent: ComponentType<Record<string, unknown>>;
  export default MDXComponent;
}
