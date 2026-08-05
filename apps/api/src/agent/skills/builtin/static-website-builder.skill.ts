import { createHash } from 'node:crypto'

export const STATIC_WEBSITE_BUILDER_SKILL_ID = 'static-website-builder'
export const STATIC_WEBSITE_BUILDER_SKILL_VERSION = '1.0.2'

export const STATIC_WEBSITE_BUILDER_SKILL_MARKDOWN = `# Static Website Builder

Build only production-ready static websites with this fixed stack and workflow.

## Fixed stack

- React and TypeScript
- Vite
- Tailwind CSS using the Vite integration
- shadcn/ui component source under \`src/components/ui\`
- Lucide React icons
- pnpm as the only package manager

Do not replace this stack. Do not add a database, server runtime, authentication backend, payment backend, private environment variable, private API key, or any feature that requires a non-static service to render.

## Workspace contract

- Project root: \`/workspace/work\`
- Platform Skill files: \`/workspace/.platform-skills/static-website-builder\`
- Initialize a new empty project by running \`bash /workspace/.platform-skills/static-website-builder/init.sh\` from \`/workspace/work\`.
- Keep application code under \`src\`, public static files under \`public\`, and reusable shadcn-style primitives under \`src/components/ui\`.
- The package scripts must include \`build\`, and \`pnpm build -- --base=./\` must create \`/workspace/work/dist/index.html\` with relative asset paths so the ZIP and Sandbox proxy preview both work.

## Product and design workflow

1. Read the user's goal and decide the information architecture before writing UI.
2. Initialize only when the project does not already exist. For modifications, inspect and edit the existing project in place.
3. Implement complete content and interactions without placeholders, ellipses, fake authentication, or fake backend success.
4. Use an intentional visual direction, responsive layout, accessible labels, visible focus states, semantic HTML, and robust overflow behavior.
5. Use Lucide icons rather than hand-authored SVG icons. Add shadcn components as source only when they help the design.
6. Run checks during implementation. Fix every build error rather than hiding or describing it away.
7. When the site is ready, call \`create_website\`. That tool is the only authority that can build, archive, and expose the website preview. A shell build or a text response is not a completed delivery.
8. If \`create_website\` reports a failure, inspect the bounded error, fix the project, and call it again. Do not end the run while the requested website remains broken.

## Delivery boundary

The final website must work from static files alone. Runtime network requests are allowed only for public, credential-free resources that the user explicitly needs; prefer local assets so the delivered site remains durable. Never place secrets, tokens, cookies, private URLs, build caches, \`node_modules\`, or repository metadata in user-facing artifacts.`

export const STATIC_WEBSITE_BUILDER_INIT_SCRIPT = `#!/usr/bin/env bash
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
`

export const STATIC_WEBSITE_BUILDER_PACKAGE_SCRIPT = `from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path('/workspace/work').resolve()
dist = (root / 'dist').resolve()
output = Path('/workspace/output').resolve()
output.mkdir(parents=True, exist_ok=True)

excluded_dirs = {'.git', '.next', '.turbo', '.vite', 'coverage', 'dist', 'node_modules'}
excluded_names = {'.DS_Store'}

def safe_files(base: Path, exclude_build: bool):
    for path in sorted(base.rglob('*')):
        if path.is_symlink() or not path.is_file():
            continue
        relative = path.relative_to(base)
        if any(part in excluded_dirs for part in relative.parts):
            continue
        if path.name in excluded_names or path.name == '.env' or path.name.startswith('.env.'):
            continue
        if exclude_build and relative.parts and relative.parts[0] == 'dist':
            continue
        yield path, relative

with ZipFile(output / 'source.zip', 'w', ZIP_DEFLATED) as archive:
    for path, relative in safe_files(root, True):
        archive.write(path, relative.as_posix())

with ZipFile(output / 'dist.zip', 'w', ZIP_DEFLATED) as archive:
    for path, relative in safe_files(dist, False):
        archive.write(path, relative.as_posix())
`

export const STATIC_WEBSITE_BUILDER_SKILL_SHA256 = createHash('sha256')
  .update(STATIC_WEBSITE_BUILDER_SKILL_MARKDOWN)
  .update('\0')
  .update(STATIC_WEBSITE_BUILDER_INIT_SCRIPT)
  .update('\0')
  .update(STATIC_WEBSITE_BUILDER_PACKAGE_SCRIPT)
  .digest('hex')

export function renderStaticWebsiteBuilderSkill(): string {
  return [
    `<built_in_skill id="${STATIC_WEBSITE_BUILDER_SKILL_ID}" version="${STATIC_WEBSITE_BUILDER_SKILL_VERSION}" sha256="${STATIC_WEBSITE_BUILDER_SKILL_SHA256}">`,
    STATIC_WEBSITE_BUILDER_SKILL_MARKDOWN,
    '</built_in_skill>',
  ].join('\n')
}
