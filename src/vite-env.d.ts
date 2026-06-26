/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CLAUDE_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
