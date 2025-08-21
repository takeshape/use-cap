/// <reference types="vite/client" />

interface ViteTypeOptions {
  strictImportMetaEnv: unknown;
}

interface ImportMetaEnv {
  readonly VITE_CAP_ENDPOINT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
