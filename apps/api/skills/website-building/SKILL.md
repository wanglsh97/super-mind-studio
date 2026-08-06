---
name: website-building
description: Build and modify production-ready static websites with the platform React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide and pnpm workflow. Use for every website-mode Agent run that must deliver a preview plus source and distribution ZIP files through create_website.
---

# Website Building

Build only production-ready static websites with this fixed stack and workflow.

## Fixed stack

- React and TypeScript
- Vite
- Tailwind CSS using the Vite integration
- shadcn/ui component source under `src/components/ui`
- Lucide React icons
- pnpm as the only package manager

Do not replace this stack. Do not add a database, server runtime, authentication backend, payment backend, private environment variable, private API key, or any feature that requires a non-static service to render.

## Workspace contract

- Project root: `/workspace/work`
- Skill files: `/workspace/.skills/website-building`
- Initialize a new empty project by running `bash /workspace/.skills/website-building/scripts/init.sh` from `/workspace/work`.
- Immediately after initialization, replace the scaffold default `package.json.name` with a concise, meaningful kebab-case project name derived from the user's website goal. Do not leave it as `work`, `app`, `vite-project`, or another generic workspace name. Preserve that name during later modifications because the platform uses it for the downloaded source archive.
- Keep application code under `src`, public static files under `public`, and reusable shadcn-style primitives under `src/components/ui`.
- The package scripts must include `build`, and `pnpm build -- --base=./` must create `/workspace/work/dist/index.html` with relative asset paths so the ZIP and Sandbox proxy preview both work.

## Product and design workflow

1. Read the user's goal and decide the information architecture before writing UI.
2. Initialize only when the project does not already exist. For modifications, inspect and edit the existing project in place.
3. Implement complete content and interactions without placeholders, ellipses, fake authentication, or fake backend success.
4. Use an intentional visual direction, responsive layout, accessible labels, visible focus states, semantic HTML, and robust overflow behavior.
5. Use Lucide icons rather than hand-authored SVG icons. Add shadcn components as source only when they help the design.
6. Run checks during implementation. Fix every build error rather than hiding or describing it away.
7. When the site is ready, call `create_website`. That tool is the only authority that can build, archive, and expose the website preview. A shell build or a text response is not a completed delivery.
8. If `create_website` reports a failure, inspect the bounded error, fix the project, and call it again. Do not end the run while the requested website remains broken.

## Delivery boundary

The final website must work from static files alone. Runtime network requests are allowed only for public, credential-free resources that the user explicitly needs; prefer local assets so the delivered site remains durable. Never place secrets, tokens, cookies, private URLs, build caches, `node_modules`, or repository metadata in user-facing artifacts.
