# Miro Style

A lean Miro-style whiteboard MVP focused on two things:

1. **Shapes** — rectangles, ellipses, diamonds, text, with connectors.
2. **AI mindmaps** — describe a topic, Claude generates a tree you can edit on the canvas.

Multiple boards are supported. Everything is stored client-side in `localStorage`, so there's no login.

## Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Tailwind CSS
- SVG canvas (pan/zoom, drag, resize, connect)
- Anthropic Messages API (`claude-sonnet-4-6`) for mindmap generation

## Local development

```bash
cp .env.example .env.local
# put your Anthropic key in .env.local
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Deploy on Vercel

1. Push this branch to GitHub (already done if Claude just pushed it).
2. Import the repo on [vercel.com/new](https://vercel.com/new) and pick this branch.
3. Add an env var: `ANTHROPIC_API_KEY`.
4. Deploy — Vercel auto-detects Next.js, no extra config needed.

## How to use

### Boards
- The home page lists every board (newest first). Use **New board** to create one.
- Hover a board card to **Rename** or **Delete** it.

### Canvas controls
- **Pan**: click-drag empty space.
- **Zoom**: scroll wheel (zooms around the cursor).
- **Add a shape**: pick a shape from the top toolbar.
- **Select**: click a shape; **Move**: drag it; **Resize**: drag a corner handle.
- **Edit text**: double-click a shape (Enter to commit, Esc to cancel).
- **Connect shapes**: toolbar → **↔ Connect** → click source, then target.
- **Delete shape**: select it and press Delete/Backspace (or the inspector).
- **Recolor**: click a swatch in the inspector (top-right when a shape is selected).

### AI mindmap
- Click **✨ AI Mindmap** in the toolbar.
- Type a topic ("Launch plan for a meal-prep startup").
- Claude returns a tree; the canvas adds the nodes laid out around your current view.
- Every node is just a normal shape — edit text, move, recolor, delete, or connect more.

## Files

```
app/
  page.tsx               board list
  board/[id]/page.tsx    board route
  api/mindmap/route.ts   POST → mindmap JSON
components/
  BoardList.tsx
  BoardEditor.tsx        canvas, toolbar, inspector, text-edit
  AIMindmapDialog.tsx
lib/
  types.ts
  storage.ts             localStorage CRUD
  mindmap.ts             tree → shapes/edges layout
  id.ts
```
