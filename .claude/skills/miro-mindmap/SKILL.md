---
name: miro-mindmap
description: |
  Generate copy-paste mindmap JSON for the Miro-Style app. Trigger when the user (in chat, not in the app UI) asks Claude to build, design, plan, brainstorm, or outline anything as a mindmap — e.g. "mindmap for launching a podcast", "build me a mindmap about climate adaptation", "structure my essay as a mindmap", "make a mindmap of X". The output is a single JSON code block matching the app's Import schema, ready to paste into the in-app **Import** dialog. Do NOT modify app code or files; this is a chat-only skill.
---

# Miro-Style mindmaps

This repo (`Miro-Style`) is a Miro-style whiteboard with an **Import** button on every board. Pasting a JSON tree into that dialog lays it out as connected shapes the user can edit. Your job, when this skill triggers, is to **produce that JSON** — nothing else. No code changes, no API calls, no extra prose inside the fenced block.

## When to use this skill

Trigger phrases (in chat):
- "make / build / design / draw / create me a mindmap of/for/about X"
- "outline X as a mindmap" / "structure X visually" / "X — mindmap form"
- "brainstorm X" when the user has previously asked for mindmaps in this conversation
- Any request whose deliverable is *a tree of related ideas the user wants on their Miro-Style board*

Do **NOT** use this skill for:
- Adding a mindmap feature to the app (that's a coding task — edit code, do not invoke this skill).
- Linear lists, tables, prose outlines, or essay drafts.
- Image generation. Users add images manually in the app (file picker / drag-drop).

## Schema

```ts
type Node = {
  label: string;                              // required, non-empty
  style?: "h1" | "h2" | "h3" | "body" | "bullet";   // optional typography preset
  align?: "left" | "center" | "right";        // optional text alignment
  children?: Node[];                          // optional sub-nodes
};
```

- `label` — required, trimmed to 200 chars by the app.
- `style` — optional. Defaults are applied by depth if you omit it:
  - depth 0 (root) → `h1`
  - depth 1 (top-level branches) → `h2`
  - depth ≥ 2 → `body`
- `align` — optional. Defaults: `center`, except `bullet` defaults to `left`.
- `children` — optional array.
- **No other keys are read.** Don't add `id`, `notes`, `color`, etc. They'll be ignored.

### Style presets (what each one renders as)

| Style    | Use for                                              | Font     | Weight |
|----------|------------------------------------------------------|----------|--------|
| `h1`     | The topic / one big concept                          | 22 px    | Bold   |
| `h2`     | Section headers (top-level branches)                 | 18 px    | Bold   |
| `h3`     | Sub-section labels                                   | 16 px    | Bold   |
| `body`   | Definitions, descriptions, normal text               | 14 px    | Normal |
| `bullet` | Action items / atomic tasks. Renders with `•` prefix | 14 px    | Normal |

**When to override `style`:**
- A leaf that's an actionable task → `"style": "bullet"`.
- A leaf that's a short metric or fact → leave as default `body`.
- A pillar header that needs to read smaller than its peers → bump to `h3`.
- Usually you don't need to set `style` at all; the depth defaults are fine.

**When to set `align`:**
- Almost never. Defaults are right. Set `"left"` only when the content is dense and reads better flush-left.

## Quality rules

**Shape of the tree**
- **Root**: the topic itself, 1–5 words, no trailing punctuation.
- **Top-level branches**: 3–6 of them. Pillars / dimensions of the topic, not details.
- **Second level**: 2–5 children per branch. Concrete, distinct, parallel in form.
- **Third level**: only when it adds real signal. Many great mindmaps stop at two levels.
- Never have a branch with one child — fold it into the parent label.

**Branch selection**
- Top-level branches should be MECE-ish: mostly non-overlapping, together covering the topic.
- Each top-level branch is a dimension or pillar, not a detail.
- Avoid meta-branches like "Overview", "Conclusion", "Resources" unless the user asks.
- **Parallelism**: siblings should be the same kind of thing at the same level of abstraction.

**Labels**
- Max 8 words for `h1`/`h2`/`h3`/`body`. Bullets can go up to ~12 words.
- Concrete > vague. "Weekly customer interviews" beats "Customer research".
- No trailing punctuation, no emojis, no quotes around labels.
- No filler prefixes ("How to…", "Why…", "Different types of…").

## Output delivery

1. **One short sentence** before the JSON, framing what you built.
2. **One ```json fenced code block**. Inside the fence: only the JSON. No comments, no `// ...`, no trailing prose, no ellipses. Must round-trip through `JSON.parse`.
3. **One short sentence** after, telling them where to paste: *"Open your board → tap **📋 Import** → paste this in."*

## Example (with style mixed in)

> **User**: build me a mindmap for launching a meal-prep startup

> **Assistant**:
>
> Here's a starting structure — edit it on the board.
>
> ```json
> {
>   "label": "Meal-prep startup launch",
>   "style": "h1",
>   "children": [
>     {
>       "label": "Product",
>       "style": "h2",
>       "children": [
>         { "label": "Weekly menu rotation", "style": "bullet" },
>         { "label": "Dietary variants (keto, veg)", "style": "bullet" },
>         { "label": "Packaging & shelf life", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Operations",
>       "style": "h2",
>       "children": [
>         { "label": "Commercial kitchen lease", "style": "bullet" },
>         { "label": "Cold-chain delivery", "style": "bullet" },
>         { "label": "Inventory & spoilage tracking", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Customers",
>       "style": "h2",
>       "children": [
>         { "label": "ICP: busy urban professionals", "style": "body" },
>         { "label": "Acquisition: IG + referral", "style": "bullet" },
>         { "label": "Retention: subscription tiers", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Unit economics",
>       "style": "h2",
>       "children": [
>         { "label": "COGS per meal", "style": "body" },
>         { "label": "Delivery cost per order", "style": "body" },
>         { "label": "Target gross margin", "style": "body" }
>       ]
>     },
>     {
>       "label": "Compliance",
>       "style": "h2",
>       "children": [
>         { "label": "Food handler permits", "style": "bullet" },
>         { "label": "Allergen labeling", "style": "bullet" },
>         { "label": "Liability insurance", "style": "bullet" }
>       ]
>     }
>   ]
> }
> ```
>
> Open your board → tap **📋 Import** → paste this in.

For most mindmaps, you can omit `style` entirely and let the depth defaults handle it — the example above is verbose only to show what's available. Add `style: "bullet"` to leaves that are action items; add `"h3"` when a pillar needs to read smaller than its siblings.

## Anti-patterns

- Don't generate Mermaid, GraphViz, OPML, Markdown bullets, or any other format. JSON only.
- Don't wrap the JSON in `const data = {...}`, `export default`, or any other JS.
- Don't add fields outside the schema (`id`, `notes`, `color`, `image`, `src`).
- Don't use `align: "right"` unless the user explicitly asks.
- Don't single-child chains (`A → B → C` with one kid each). Collapse.
- Don't pad to hit a count. 4 strong branches beats 6 with filler.
- Don't ask "what aspects do you care about?" for clearly scoped topics. Just deliver.

## When to ask before generating

Only ask **one** focusing question when the topic is genuinely too broad to be useful (e.g. "make me a mindmap about technology"). For moderately scoped topics, just produce the JSON.
