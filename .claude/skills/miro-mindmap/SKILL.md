---
name: miro-mindmap
description: |
  Generate copy-paste mindmap JSON for the Miro-Style app. Fires when the user (in chat) asks Claude to make/build/design/plan/outline/brainstorm something as a mindmap, OR pastes a voice-message transcript they want structured as a tree, OR uses /mindmap-style invocations. Produces a single JSON code block matching the app's Import schema (label / style / align / children), ready to paste into the in-app Import dialog. Aggressively compresses verbose or disfluent input into tight, parallel labels. Chat-only — never edits code or repo files.
---

# Miro-Style mindmap skill

You produce **one JSON object** that the user pastes into the **📋 Import** dialog. That's the whole deliverable. No code changes, no commentary inside the fenced block, no markdown bullet-list "outlines" disguised as mindmaps.

---

## 1. When to fire

**Trigger explicitly on:**

- "make / build / design / draw / create / give me a mindmap of/for/about X"
- "outline X as a mindmap" • "structure X visually" • "X — mindmap form"
- "brainstorm X" inside a conversation that has been about mindmaps
- "turn this into a mindmap" / "tree this out" / "organize this"
- A pasted block of free-form text or transcript followed by "mindmap" / "as a tree" / "organize"
- A voice-message transcript (disfluencies + a clear topic) where the user's intent is to capture the contents on the board
- "structure this as a YouTube video" / "YT script for X" / "video about X with retention structure" / "make a video from this voice note" — emit the **retention-driven YT** template (see §5)

**Don't fire for:**

- Coding tasks ("add a mindmap feature to the app") → edit code instead
- Linear writing requests ("write me an essay about X") → just write it
- Pure Q&A ("what is X?") → answer it
- Image generation (the app handles images manually; you can't paint them)

---

## 2. Voice-message / transcript pre-processing

Voice input arrives as a single run-on paragraph with disfluencies. **Before** you sketch the tree, do this pass in your head:

1. **Strip fillers**: "um", "uh", "like", "you know", "I mean", "kind of", "basically", "so", "right", "okay".
2. **Strip self-corrections**: "not that, I mean…" → keep the corrected version only.
3. **Strip meta-wrapping**: "ok so I want to make a mindmap about…" — the topic is what comes after, not the wrapping.
4. **Re-segment**: split where the speaker pivots — "another thing is…", "and then…", "also…", "the next one…", "I'm thinking maybe…". Each segment is a candidate top-level branch.
5. **Promote sub-mentions**: a phrase like "marketing, which is mostly LinkedIn and referrals" → branch = Marketing, children = LinkedIn, Referrals. Inline elaborations (after "which is", "for example", "like", "such as") become children.
6. **Use the speaker's vocabulary verbatim** for the top of the tree. If they say "users", don't replace with "customers". If they say "Q3 plans", don't call it "Quarterly Strategy".
7. **Compress 10×**. A 90-second voice message has ~200 words. The final mindmap has maybe 20–30 labels. Aggressive compression is the job.
8. **Pick the topic from the middle of the ramble**, not necessarily the first sentence. If the speaker says "I want a mindmap about… umm… my coaching business and like specifically what to do this quarter", topic is "Coaching business — Q3 plan", not "My coaching business".
9. **Don't ask clarifying questions on voice transcripts.** They asked because they want structure imposed on the mess. Impose it. They'll edit on the board.

If you find yourself transcribing the speaker's words verbatim into labels, you're failing — keep compressing.

---

## 3. Schema (exact)

The import accepts **either** of two shapes. Pick whichever fits the request.

### 3a. Single tree (default)

```ts
type Node = {
  label: string;                                       // required, non-empty
  style?: "h1" | "h2" | "h3" | "body" | "bullet";      // optional preset
  align?: "left" | "center" | "right";                 // optional alignment
  children?: Node[];                                   // optional sub-nodes
};
```

Use this when the whole topic is one connected hierarchy — every node hangs off the root.

### 3b. Sections (multi-block boards) — preferred for video scripts

```ts
type Doc = {
  sections: Section[];
};

type Section = {
  title?: string;                          // optional small header above
  layout?: "tree" | "compare" | "row";     // defaults to "tree"
  nodes: Node[];                           // see Node above
};
```

A section is an **independent cluster** on the board. Sections are stacked vertically with breathing room; **no edges connect across sections**. Use sections when the deliverable is a *script* or *deck* — different beats want different shapes:

| `layout` | What it produces | Use for |
|----------|------------------|---------|
| `"tree"` (default) | One root + children, edges connecting parent→child. `nodes[0]` is the root. | A normal mindmap section. The default unless another layout fits better. |
| `"compare"` | Two (or more) sub-trees side-by-side with a wide gap. Each root gets its own theme color. No edges between them. | A/B comparisons. "Person who does X" vs "Person who doesn't." Pros vs cons. Before vs after. |
| `"row"` | Multiple sub-trees side-by-side with a smaller gap. Each gets its own theme color. No edges between them. | A row of parallel items the viewer should see together: three tactics, four examples, five questions. |

Section behavior:
- A section with `layout: "tree"` uses `nodes[0]` as the root and ignores the rest. Don't put unrelated content under one tree section.
- A `"compare"` section reads best with **exactly 2** nodes. Three works; one defeats the purpose.
- A `"row"` section is great for 2–6 nodes. More than 6 = use a tree instead.
- The optional `title` renders as a small centered heading above the section.
- Sections are NOT connected to each other. If two ideas need an edge between them, put them in the same section.

- `label` — required. App trims to 200 chars; aim for ≤ 6 words wherever possible.
- `style` — optional. Defaults applied by depth if you omit: root → `h1`, level-1 → `h2`, deeper → `body`. **You can omit `style` entirely for most mindmaps** and rely on defaults.
- `align` — optional. Defaults: `center`; bullet defaults to `left`. **Rarely set this.**
- `children` — optional array.
- **No other keys are read.** No `id`, `notes`, `color`, `image`, `src`, `priority`, `tags`.

### Style presets

| Style    | Use for                                       | Renders as       |
|----------|-----------------------------------------------|------------------|
| `h1`     | The topic (one node, at root)                 | 22 px, bold      |
| `h2`     | Top-level pillars / sections                  | 18 px, bold      |
| `h3`     | Sub-pillars when a section has its own header | 16 px, bold      |
| `body`   | Concepts, descriptions, normal nouns          | 14 px, normal    |
| `bullet` | Action items, tasks, list elements            | 14 px, • prefix  |

**When to override the default:**
- Leaf is an actionable task → `"style": "bullet"`.
- A pillar header reads better smaller because it's a *sub-pillar* and you don't want it to compete with siblings → `"h3"`.
- A definition or fact → `"body"` (this is also the default at depth ≥ 2, so often unnecessary).

If in doubt, **omit `style`** and let depth defaults do the work.

---

## 4. Decomposition — how to find the branches

Before you sketch labels, decide **what axis the topic decomposes along**. A mindmap's value comes almost entirely from picking the right axis. Common patterns:

| Topic kind | Default decomposition |
|---|---|
| **Plan / strategy** ("Q3 plan", "launch plan") | Audience · Offer · Distribution · Operations · Metrics |
| **Build / ship** ("how do I launch X") | Spec · Build · Test · Ship · Iterate |
| **Concept / mechanism** ("how X works") | Input · Core mechanism · Output · Edge cases · Failure modes |
| **Decide** ("should I do X", "X vs Y") | Options · Criteria · Tradeoffs · Recommendation |
| **Diagnose** ("why is X happening", "why am I losing Y") | Symptoms · Hypotheses · Diagnostics · Fixes |
| **Compare** ("X vs Y vs Z") | One branch per **dimension of comparison**; X, Y, Z appear as leaves under each |
| **Learn / study** ("teach me X") | Foundations · Tools · Practice · Examples · Open questions |
| **Brainstorm** ("ideas for X") | 4-6 angles (the lens) · each with 2-5 concrete ideas (the move) |
| **Audit / review** ("what's wrong with X") | Strengths · Weaknesses · Risks · Quick wins |

These are starting points, not templates. When the topic has its own natural axis (a recipe → steps; an org → departments; a body → systems), follow the topic.

**Decomposition test** — imagine a stranger reads only your top-level branches, leaves hidden. Can they guess the topic from the branches alone?
- Yes → branches are doing real work.
- Sort of → branches are generic ("Strategy", "Process", "Approach") and you should rewrite.
- No → you've picked filler categories. Restart from a different axis.

**Cue picking from the prompt**:
- "Plan for X" / "what to do" → planning axis, leaves as actions (bullets).
- "How X works" / "what is X" → concept axis, leaves as parts (body).
- "Should I X" / "X or Y" → decision axis.
- "Why is X" / "what's broken" → diagnostic axis.
- "Ideas for X" / "brainstorm" → brainstorm axis, wider + shallower.
- Voice ramble with multiple "and then also…" pivots → each pivot is a candidate branch.

## 5. Topic-type calibration

The same JSON schema looks different in practice depending on the kind of topic:

- **Planning** — leaves are mostly **`style: "bullet"`** (action items, verb-leading). Tree depth 2-3. Branches are *areas of work*; leaves are *concrete next moves*. Aim for 4-5 branches with 3-4 actions each.
- **Concept** — leaves stay on the default `body` style. Tree often goes to depth 3 because mechanisms have sub-mechanisms. Branches map to *real parts* of the thing, not metaphors. Don't add action-item bullets — they're out of place.
- **Decision** — narrower trees. Usually 3-4 branches: Options, Criteria, Tradeoffs, Recommendation. Recommendation gets 1-2 short bullets stating the call and the reason.
- **Diagnostic** — 4 branches typical: Symptoms (body), Hypotheses (body), Diagnostics (bullet — what to do to test), Fixes (bullet — what to do once you know).
- **Brainstorm** — wider, shallower. 5-6 branches at depth 1; 3-5 leaves each; rarely depth 3. Leaves can be unconventional ideas — the value is breadth, not safety.
- **YouTube video script** (retention-driven) — fires when the user says "structure this as a YT video", "video script for X", or hands you a voice note about a video idea. Use the fixed 5-branch template below. This is the highest-value request right after a voice note — recognize it.

If the prompt is ambiguous about type, default to a **planning** structure with mostly body leaves — that's what users want most often.

### YouTube video script template (retention-driven)

Branches are exactly these five, in this order, each `style: "h2"`. No sixth branch.

1. **Hook** — 1-2 `bullet` leaves. Each is a one-line cold open. The hook states the *tension*, not the answer. Never "Hi I'm…" or "In this video I'll…". Pattern interrupt first, payoff later.
2. **Setup** — 2-3 leaves answering *what they'll learn, why now, who it's for*. These are the **sub-promises** the viewer collects throughout the video. Spread them so they pay off later.
3. **Body** — 3-5 children, each an `h3` named for the section. Inside each `h3`, exactly three leaves in this order:
   1. A `body` leaf stating the **main point** of the section (one sentence).
   2. 1-2 `bullet` leaves with **B-roll / example cues** — concrete and visual ("show the spreadsheet", "cut to phone screen", "graph zoom-in").
   3. One `bullet` leaf starting with **"Open loop:"** that teases the next section.
4. **Payoff** — 2-3 `body` leaves: the reveal that resolves the biggest open loop, the reason it works, and the so-what for the viewer.
5. **CTA** — 1-2 `bullet` leaves. Subscribe / watch-next / comment prompt. Always last; never mid-video.

**Retention rules baked into the labels:**
- Hook never gives the answer; it sets up a tension.
- Every Body sub-section opens *one* loop, closed inside that section or in Payoff. Don't open a loop you don't pay off.
- Setup sub-promises are claims you redeem inside Body. Don't promise what you don't deliver.
- B-roll cues are concrete and visual, written as on-screen directions, not abstract concepts.
- CTA at the end only. Mid-video CTAs kill retention.

**Mapping a voice note onto this template:**
- The "what's broken / what's interesting" the speaker opens with → Hook.
- The "what I want viewers to walk away with" → Setup sub-promises.
- The numbered or sequential thoughts in the middle → Body sub-sections, one `h3` each.
- The "the lesson" / "the kicker" they say toward the end → Payoff.
- Add a generic CTA if not specified.

**Use sections, not one tree, when the script has visually different beats:**

A long script almost never fits cleanly into a single tree. Reach for the sections schema (§3b) and pick a layout per beat. A common pattern:

```json
{
  "sections": [
    { "title": "Hook: A vs B", "layout": "compare", "nodes": [ /* two short trees: the contrast */ ] },
    { "title": "The mechanism", "layout": "tree", "nodes": [ /* one h1 root with branches */ ] },
    { "title": "Try this week", "layout": "row", "nodes": [ /* 3-5 bullet roots, no children */ ] }
  ]
}
```

- Hook beat → `"compare"` works when the hook is "person who does X vs person who doesn't".
- Body / mechanism beat → `"tree"` for the connected breakdown.
- Steps / takeaways beat → `"row"` for a row of independent things the viewer should remember.

Don't force every beat into one tree just because it's the default. If two ideas in your script aren't actually causally connected, they shouldn't be in the same tree.

## 6. Quality rules

### Tree shape
- **Branch count**: 4–5 default. 3 if user says "just a few" or topic is narrow. 6 if user says "comprehensive" or "exhaustive". Never < 3 (that's not a mindmap, it's a list). Never > 7 (that's chaos).
- **Children per branch**: 2–5. Same calibration.
- **Depth**: 2 levels (root + 1) for tactical topics. 3 levels (root + 2) when a pillar naturally subdivides. 4+ levels almost never — you're overthinking it.
- **Never single-child chains.** If a branch has exactly one child, fold them: `Marketing → LinkedIn` becomes a single node `Marketing: LinkedIn` or just `LinkedIn` depending on context.
- **Balance**: branches should be roughly the same depth. Don't have one branch with 8 grandchildren while peers have none. Promote details up or trim them.

### Branch selection (the hard part)
- **MECE-ish**: branches should be mostly non-overlapping and together cover the topic. Test: can you defend why exactly these branches? If a 6th branch overlaps two existing ones, merge.
- **Each branch is a dimension**, not a detail. "Pricing strategy" is a dimension. "Charge $9/mo" is a detail (belongs as a child).
- **Avoid meta-branches** unless explicitly requested: "Overview", "Background", "Introduction", "Conclusion", "Resources", "Considerations", "Things to Remember", "Other", "Misc", "Notes". They are filler.
- **Parallelism within a level**: all top-level branches should be the same *kind* of thing.
  - ❌ `["Vision", "Hire 3 engineers", "Marketing", "Q3 goals"]` — mixes strategic (Vision, Marketing) with tactical (Hire 3 engineers) with temporal (Q3 goals).
  - ✅ `["Product", "Team", "Marketing", "Operations"]` — all functional areas.
- **Parallelism within a branch**: all children should also be the same kind (all tactics, or all metrics, or all questions — not mixed).

### Labels
- **Length**: ≤ 6 words for `h1`/`h2`/`h3`/`body`. Bullets can go to ~12.
- **Concrete > vague**:
  - ❌ "Customer research" → ✅ "Weekly customer interviews"
  - ❌ "Improve operations" → ✅ "Cold-chain delivery"
  - ❌ "Strategy" → ✅ "Niche down to one ICP"
- **No filler prefixes**: "How to…", "Why…", "Different types of…", "Things related to…". Just the noun phrase or verb phrase.
- **No trailing punctuation**, no emojis, no quotes inside labels, no markdown formatting in labels (`**bold**`, `_italic_` won't be parsed).
- **Bullet labels start with a verb**: "Raise prices for new clients", "Ship onboarding doc". Not "Pricing raise" or "Onboarding".

### Excellent vs mediocre vs bad

Under a `Pricing` branch in a coaching-business plan:

| Tier | Leaves |
|---|---|
| ❌ **Bad** (filler categories) | "Strategy", "Methods", "Analysis", "Considerations" |
| ⚠️ **Mediocre** (concrete but generic) | "Raise prices", "Review pricing", "Consider tiers" |
| ✅ **Excellent** (specific, opinionated, ready to act on) | "Raise rates 20% for new clients", "Add annual-prepay 15% discount", "Cut the free intro call", "Add a $500 strategy-day tier" |

The excellent tier is what you should be writing every time. If your leaves look like the mediocre tier, push for one more level of specificity before posting.

### Domain language
- **Match the user's register**. Casual prompt → casual labels. Technical prompt → technical labels.
- **Preserve their nouns**: ICP, retros, MRR, IFS, MVP — if they use the term, you use the term.
- **Don't corporate-ify** plain-English requests. "Get more customers" stays "Get more customers", not "Customer acquisition optimization".

---

## 7. Output delivery

Your reply has exactly three parts, in order:

1. **One short sentence** framing what you built. ≤ 12 words. No "Here is" / "Below is" if you can avoid it.
2. **One fenced ```json block**. Inside the fence: only the JSON object. No comments (`// …`), no trailing prose, no ellipses, no placeholder values. Must round-trip through `JSON.parse`. Use 2-space indent for readability.
3. **One short sentence** telling them where to paste. Always: *"Open your board → tap **📋 Import** → paste this in."*

Nothing else. No bullet-list recap. No "let me know if…". No "I can also…" upsell.

---

## 8. Pre-emit self-check

Before you press send, mentally run this checklist. If anything fails, fix it.

- [ ] Is the root a 1–5 word noun phrase that IS the topic (not "Mindmap about X")?
- [ ] Are there 3–6 top-level branches, and could I defend each one as a distinct dimension?
- [ ] Do all top-level siblings feel like the same *kind* of thing (functions, phases, audiences…)?
- [ ] Does every branch have at least 2 children (no single-child chains)?
- [ ] Is each label ≤ 6 words (≤ 12 for bullets)?
- [ ] Are any labels generic filler ("Overview", "Considerations", "Strategy")? Cut or rewrite.
- [ ] Did I add fields outside the schema (`id`, `notes`, `color`)? Remove.
- [ ] Does the JSON parse? No trailing commas, no single quotes, no markdown inside strings.
- [ ] Is the response: one-sentence-intro + JSON block + one-sentence-outro? Anything else? Cut it.

---

## 9. Examples

### Example A — Plan with bullet leaves

> **User**: build me a mindmap for launching a meal-prep startup

> **You**:
>
> Five pillars, with the leaves as concrete first moves.
>
> ```json
> {
>   "label": "Meal-prep startup launch",
>   "children": [
>     {
>       "label": "Product",
>       "children": [
>         { "label": "Weekly menu rotation", "style": "bullet" },
>         { "label": "Dietary variants (keto, veg)", "style": "bullet" },
>         { "label": "Packaging & shelf life", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Operations",
>       "children": [
>         { "label": "Commercial kitchen lease", "style": "bullet" },
>         { "label": "Cold-chain delivery", "style": "bullet" },
>         { "label": "Inventory & spoilage tracking", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Customers",
>       "children": [
>         { "label": "ICP: busy urban professionals" },
>         { "label": "Acquisition: IG + referral", "style": "bullet" },
>         { "label": "Retention: subscription tiers", "style": "bullet" }
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

### Example B — Concept breakdown (no bullets, depth 2)

> **User**: mindmap for how transformers work

> **You**:
>
> Concept tree from input to output.
>
> ```json
> {
>   "label": "How transformers work",
>   "children": [
>     {
>       "label": "Tokenization & embeddings",
>       "children": [
>         { "label": "BPE / WordPiece" },
>         { "label": "Token IDs → vectors" },
>         { "label": "Positional encoding" }
>       ]
>     },
>     {
>       "label": "Attention",
>       "children": [
>         { "label": "Query, key, value projections" },
>         { "label": "Scaled dot-product softmax" },
>         { "label": "Multi-head parallel attention" },
>         { "label": "Causal masking (decoder-only)" }
>       ]
>     },
>     {
>       "label": "Block stack",
>       "children": [
>         { "label": "Residual + LayerNorm" },
>         { "label": "Feed-forward MLP" },
>         { "label": "Repeat N layers" }
>       ]
>     },
>     {
>       "label": "Output head",
>       "children": [
>         { "label": "Final LayerNorm" },
>         { "label": "Project to vocab logits" },
>         { "label": "Softmax → next-token distribution" }
>       ]
>     },
>     {
>       "label": "Training signal",
>       "children": [
>         { "label": "Next-token cross-entropy" },
>         { "label": "Backprop through attention" },
>         { "label": "Learned positional + weight params" }
>       ]
>     }
>   ]
> }
> ```
>
> Open your board → tap **📋 Import** → paste this in.

### Example C — Voice transcript → mindmap

> **User**: ok so i want to make a mindmap for um my coaching business basically i'm trying to figure out what to do this quarter so the main things would be like getting more clients which i think is the biggest one because i don't have enough right now and then also like uh raising my prices because i'm undercharging i know that and then the third thing would be uh content because i need to be more visible on linkedin and instagram um and also operations like i need to clean up my booking flow and my contracts and stuff and i'm thinking maybe a fifth thing which is retention because i lose clients after like 3 months and i don't know why

> **You**:
>
> Five priorities for the quarter, with the speaker's sub-mentions promoted to leaves.
>
> ```json
> {
>   "label": "Coaching business — Q3 priorities",
>   "children": [
>     {
>       "label": "Client acquisition",
>       "children": [
>         { "label": "Top priority — pipeline too thin" },
>         { "label": "Outbound channel test" },
>         { "label": "Referral asks at each session", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Pricing",
>       "children": [
>         { "label": "Currently undercharging" },
>         { "label": "Raise rates for new clients", "style": "bullet" },
>         { "label": "Higher-tier offer", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Content & visibility",
>       "children": [
>         { "label": "LinkedIn weekly posts", "style": "bullet" },
>         { "label": "Instagram clips from sessions", "style": "bullet" },
>         { "label": "One pillar piece per month", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Operations",
>       "children": [
>         { "label": "Booking flow cleanup", "style": "bullet" },
>         { "label": "Contract templates", "style": "bullet" },
>         { "label": "Onboarding doc", "style": "bullet" }
>       ]
>     },
>     {
>       "label": "Retention",
>       "children": [
>         { "label": "Clients churn near month 3" },
>         { "label": "Diagnose: exit interviews", "style": "bullet" },
>         { "label": "90-day check-in ritual", "style": "bullet" }
>       ]
>     }
>   ]
> }
> ```
>
> Open your board → tap **📋 Import** → paste this in.

Notice: the transcript said five things; the mindmap has five branches. Each branch's *first* leaf restates the speaker's reason ("biggest one", "undercharging", "lose at 3 months"). The rest are concrete next moves the speaker implied or that obviously follow. Labels are tight; the speaker's casual ramble is gone.

---

## 10. Anti-patterns (do not do)

- ❌ Returning Mermaid, GraphViz, OPML, ASCII trees, indented bullet lists, or anything other than the JSON.
- ❌ Wrapping the JSON in `const data = …`, `export default`, or assigning to a variable.
- ❌ Adding schema-foreign fields (`id`, `notes`, `color`, `image`, `src`, `priority`, `tag`, `weight`). They'll be dropped at import and confuse the user.
- ❌ Filler branches: "Overview", "Background", "Conclusion", "Resources", "Other", "Misc", "Considerations".
- ❌ Filler label prefixes: "How to…", "Why…", "Different types of…", "Things to consider about…".
- ❌ Single-child chains. Collapse them.
- ❌ Padding to hit a branch count. 4 strong branches > 6 with filler.
- ❌ Echoing the user's prompt back at them in prose.
- ❌ Asking clarifying questions for moderately scoped topics. Deliver; the user edits on the board.
- ❌ Setting `align: "right"` unless the user explicitly requested it.
- ❌ Using `style: "h1"` on anything other than the root. (It's the topic style.)
- ❌ Stuffing markdown into label strings (`**bold**`, `_italic_`, `[link](…)`). They render as literal characters.

---

## 11. Edge cases

| Situation | Do |
|-----------|-----|
| Topic is genuinely too broad ("mindmap about technology") | Ask exactly **one** focusing question, then deliver. Don't go back and forth. |
| User asks a follow-up like "add a branch for X" or "make the Marketing branch deeper" | Re-emit the *whole* updated JSON, not a diff. The import dialog takes complete trees. |
| User pastes a list ("here are 12 things, organize as a mindmap") | Cluster the items into 4–5 groups; the items become leaves; the groups become branches. Don't keep all 12 at the top level. |
| Topic is fundamentally linear (a recipe, a chronological story) | Tell the user once that a mindmap may not be the best shape, and suggest a flow-style alternative. If they still want a mindmap, build one anyway with phases as branches. |
| The "topic" is actually a single concept that can't decompose (e.g. "the number 7") | Say so in one sentence and propose what they probably meant ("a mindmap of *facts about 7*"? *uses of 7*?). |
| User says "smaller" or "simpler" after a previous mindmap | Halve the branches; cut all level-2 children that aren't critical. |
| User says "deeper" or "more detail" | Add a third level to the 2–3 most substantive branches, not all of them. |

---

## 12. Style discipline summary (one screen)

- Compress voice → 10× shorter labels
- 4–5 top-level branches by default
- 2–5 children per branch
- Each branch a different *dimension* of the topic
- Parallelism within levels
- Bullets for action verbs; defaults for everything else
- One JSON block, no extras
- No filler branches, no filler label prefixes
- Preserve the user's own terminology

If you do all of this, the user pastes once and gets a board they'd be proud to show someone.
