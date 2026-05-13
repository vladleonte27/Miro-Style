# Miro Style

A lean, mobile-friendly Miro-style whiteboard:

1. **Shapes** — rectangles, ellipses, diamonds, text, with connectors.
2. **Mindmap import** — generate a JSON mindmap in chat with Claude, paste it into the board, edit visually.

Multiple boards are supported. Everything is stored client-side in `localStorage`, so there's no login.

## Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS
- SVG canvas with Pointer Events (mouse + touch + pen) and pinch-zoom
- Zero external runtime services — fully static + client-side

## Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvladleonte27%2Fmiro-style&project-name=miro-style&repository-name=miro-style)

Import the repo, deploy. No env vars required.

## Local development

```bash
npm install
npm run dev
# http://localhost:3000
```

## How to use

### Boards
- Home page lists every board (newest first). **New board** creates one.
- Hover/long-press a card → **Rename** / **Delete**.

### Canvas (phone-first)
- **Pan**: one-finger drag on empty space.
- **Zoom**: pinch (or scroll wheel on desktop).
- **Add shape**: bottom toolbar → **+ Shape** → pick a kind.
- **Select**: tap a shape. You'll see resize handles at the corners (sky-blue) and **4 indigo dots** at the edge midpoints.
- **Move**: drag selected shape.
- **Resize**: drag a corner handle (large hit areas for thumbs).
- **Connect (fast)**: drag from one of the 4 indigo dots onto another shape — release on the target (it'll glow green) to wire it up. A dashed indigo line follows your finger so you see what's about to happen.
- **Connect (tap-tap)**: bottom toolbar → **↔ Connect** → tap source, tap target. Useful for shapes far apart.
- **Edit text**: double-tap a shape, or select → tap **✎**. While editing you get a floating top bar with **B / I / H / A− / A+ / Done**. Changes preview live in the textarea and on the shape underneath.
- **Format without editing**: with a shape selected, the inspector at the bottom gives you **B / I / H / A− / A+**, color swatches, **✎**, **🗑** — all in one row + a swatches row.
- **Delete board**: top-right **⋮** menu.

### Mindmap import (the magic part)

1. Ask Claude in chat: *"build me a mindmap about Q3 launch plan"*.
2. Claude (using the `miro-mindmap` skill in this repo) returns a JSON block.
3. On your board, tap **📋 Import** (bottom toolbar).
4. Tap **📋 Paste** (or long-press the textarea and paste). Tap **Add to board**.
5. The mindmap lands on the canvas as connected, editable shapes.

The JSON schema is just:

```ts
type Node = { label: string; children?: Node[] };
```

## Files

```
app/
  page.tsx                     boards list
  board/[id]/page.tsx          board route
  layout.tsx                   viewport meta (mobile)
components/
  BoardList.tsx
  BoardEditor.tsx              canvas + pointer events + pinch zoom + toolbar + inspector
  ImportDialog.tsx             paste-JSON modal
lib/
  types.ts                     Board / Shape / Edge types
  storage.ts                   localStorage CRUD
  mindmap.ts                   tree → shapes/edges layout + JSON sanitizer
  id.ts
.claude/skills/miro-mindmap/
  SKILL.md                     teaches Claude how to write good mindmap JSON
```

## The `miro-mindmap` Claude skill

Repo-local skill at `.claude/skills/miro-mindmap/SKILL.md`. When you ask Claude (in a session opened in this repo) to "build a mindmap of X", the skill kicks in and emits JSON that matches the import schema — with rules baked in for branch count, parallelism, label length, and anti-patterns. Tweak that file to evolve the style.
