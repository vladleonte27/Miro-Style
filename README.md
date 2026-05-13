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
- **Select**: tap a shape. Resize handles (sky-blue squares) appear at corners; 4 indigo connection dots at edge midpoints.
- **Move**: drag the shape. Pink alignment guides snap it to other shapes' edges and centers.
- **Resize**: drag a corner.
- **Connect (anchored)**: drag from one indigo dot onto another shape. The line emerges out of that exact edge (top dot → curve goes up first; bottom dot → curve goes down first). As you hover a target shape, the nearest target anchor highlights **green** — release to lock to that anchor. Edges are curved bezier paths with arrowheads, and each end remembers which side of its shape it's attached to.
- **Connect (tap-tap)**: toolbar → **↔ Connect** → tap source, tap target. Endpoints are auto-chosen.
- **Edit text**: double-tap, or select → **✎**. WYSIWYG: the textarea has the same bg, font, weight, italic, line-height, and clip-path as the rendered shape, so what you type *is* what you'll see.
- **Format**: **B / I / H** toggles, **A− / A+** font size with a live readout, fill swatches, and highlight swatches (when H is on). Same controls appear in both the selection inspector and the editing top bar.
- **Undo / Redo**: floating ↶ ↷ pill in the canvas top-left. Keyboard: **Cmd/Ctrl+Z**, **Cmd/Ctrl+Shift+Z**.
- **Duplicate shape**: ⎘ in the inspector, or **Cmd/Ctrl+D**.
- **Delete shape**: 🗑 in the inspector, or **Delete/Backspace** with a shape selected.
- **Delete board**: top-right **⋮** menu.

### Mindmaps
- Generated mindmaps lay out **top-down**: root at the top, branches below.
- After import, the canvas auto-fits and zooms to frame the new tree.
- Every node is a regular shape — drag, recolor, resize, change font, attach more connections.

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
