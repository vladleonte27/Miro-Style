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
- Linear lists, tables, prose outlines, or essay drafts (the schema is a tree; if a tree doesn't fit the request, say so).

## Schema (exact)

The app's `sanitizeMindmap` accepts exactly:

```ts
type Node = { label: string; children?: Node[] };
```

- `label`: required, non-empty string. App trims to 80 chars.
- `children`: optional array of Nodes. Missing or `[]` = leaf.
- **No other keys are read.** Don't add `id`, `description`, `notes`, `color`, etc. They'll be ignored and confuse the user.

## Quality rules

These are what makes the output actually useful instead of a generic blob.

**Shape of the tree**
- **Root**: the topic itself, 1–5 words, no trailing punctuation, no quotes.
- **Top-level branches**: aim for **3–6**. Fewer than 3 = the topic is too narrow for a mindmap (write something else). More than 6 = you're listing, not categorizing.
- **Second level**: 2–5 children per branch.
- **Third level**: only when it adds real signal. Many great mindmaps stop at two levels. Don't pad.
- Never have a branch with one child — fold it into the parent label.

**Branch selection**
- Top-level branches should be **MECE-ish**: mostly non-overlapping, together covering the topic. Test: can you defend why these exact branches?
- Each top-level branch is a **dimension or pillar**, not a detail. ("Pricing" is a branch; "Charge $9/mo" is a leaf.)
- **Avoid meta-branches** like "Overview", "Introduction", "Conclusion", "Resources", "Other", "Misc" unless the user explicitly asked for them. They're filler.
- **Parallelism**: siblings should be the same kind of thing.
  - Bad: `["Vision", "Hire 3 engineers", "Marketing", "Q3 goals"]` — mixes abstraction levels.
  - Good: `["Product", "Team", "Marketing", "Operations"]`.
  - Within a branch, all children should be the same kind too (all tactics, or all metrics, or all questions — not mixed).

**Labels**
- Max **8 words**, ideally ≤ 6.
- Concrete > vague. "Weekly customer interviews" beats "Customer research".
- Strip articles ("the", "a") where natural.
- No trailing punctuation, no emojis, no quotes around labels.
- No filler prefixes like "Different types of…", "How to…", "Why…" — just the noun phrase.

**Tone**
- Match the user's domain language. Technical user → technical labels.
- Don't editorialize ("Amazing idea: …"). Just the structure.

## Output delivery

1. **One short sentence** before the JSON, framing what you built. (Optional: ask if they want it expanded after.)
2. **One ```json fenced code block**. Inside the fence: only the JSON object. No comments, no `// ...`, no trailing prose, no ellipses.
3. **One short sentence** after, telling them where to paste: *"Open your board → tap **📋 Import** → paste this in."*
4. That's it. No bullet recap of branches, no "let me know if…". Keep it tight.

### Format guarantees
- Valid JSON: `JSON.parse` must accept it. No trailing commas, no single quotes, no comments.
- Pretty-printed with 2-space indent for readability (the app accepts any whitespace).
- No non-ASCII characters in labels unless the topic requires them.

## Example

> **User**: build me a mindmap for launching a meal-prep startup

> **Assistant**:
>
> Here's a starting structure — edit it on the board.
>
> ```json
> {
>   "label": "Meal-prep startup launch",
>   "children": [
>     {
>       "label": "Product",
>       "children": [
>         { "label": "Weekly menu rotation" },
>         { "label": "Dietary variants (keto, veg)" },
>         { "label": "Packaging & shelf life" }
>       ]
>     },
>     {
>       "label": "Operations",
>       "children": [
>         { "label": "Commercial kitchen lease" },
>         { "label": "Cold-chain delivery" },
>         { "label": "Inventory & spoilage tracking" }
>       ]
>     },
>     {
>       "label": "Customers",
>       "children": [
>         { "label": "ICP: busy urban professionals" },
>         { "label": "Acquisition: IG + referral" },
>         { "label": "Retention: subscription tiers" }
>       ]
>     },
>     {
>       "label": "Unit economics",
>       "children": [
>         { "label": "COGS per meal" },
>         { "label": "Delivery cost per order" },
>         { "label": "Target gross margin" }
>       ]
>     },
>     {
>       "label": "Compliance",
>       "children": [
>         { "label": "Food handler permits" },
>         { "label": "Allergen labeling" },
>         { "label": "Liability insurance" }
>       ]
>     }
>   ]
> }
> ```
>
> Open your board → tap **📋 Import** → paste this in.

## Anti-patterns (do not do)

- ❌ Generating Mermaid, GraphViz, OPML, Markdown bullets, or any other format. JSON only.
- ❌ Wrapping the JSON in `const data = {...}`, `export default`, or other JS.
- ❌ Adding fields not in the schema (`id`, `notes`, `color`).
- ❌ Single-child chains (`A → B → C` where each has only one child). Collapse.
- ❌ Branches like "Other", "Miscellaneous", "TBD".
- ❌ Padding to hit a count. 4 strong branches beats 6 with filler.
- ❌ Asking "what aspects do you care about?" for clearly scoped topics. Just deliver — they can edit on the board.

## When to ask before generating

Only ask **one** focusing question when the topic is genuinely too broad to be useful (e.g. "make me a mindmap about technology"). For everything moderately scoped, just produce the JSON.
