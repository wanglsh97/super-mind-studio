#!/usr/bin/env bash
set -euo pipefail

if [ -e package.json ]; then
  echo "package.json already exists; refusing to overwrite the current project" >&2
  exit 2
fi

if ! pnpm --version >/dev/null 2>&1; then
  npm install --global pnpm@9.15.9
fi

pnpm create vite@6.5.0 . --template react-ts
pnpm add react@19 react-dom@19 tailwindcss@4 @tailwindcss/vite@4 lucide-react clsx tailwind-merge class-variance-authority @radix-ui/react-slot
pnpm add -D vite@6 @vitejs/plugin-react@4 typescript@5.9 @types/node@22 @types/react@19 @types/react-dom@19

cat > vite.config.ts <<'EOF'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
EOF

cat > tsconfig.app.json <<'EOF'
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
EOF

cat > components.json <<'EOF'
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "css": "src/index.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
EOF

mkdir -p src/lib src/components/ui
cat > src/lib/utils.ts <<'EOF'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
EOF

cat > src/index.css <<'EOF'
@import "tailwindcss";

@theme {
  --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
}

html { color-scheme: light; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
button, a { -webkit-tap-highlight-color: transparent; }
EOF

echo "Static website scaffold initialized with Vite, Tailwind, shadcn aliases and Lucide."
