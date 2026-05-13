import type { Edge, Shape, ShapeKind, TextAlign } from "./types";
import { newId } from "./id";

export type MindmapStyle = "h1" | "h2" | "h3" | "body" | "bullet";
export type SectionLayout = "tree" | "compare" | "row";

export interface MindmapNode {
  label: string;
  style?: MindmapStyle;
  align?: TextAlign;
  children?: MindmapNode[];
}

export interface MindmapSection {
  title?: string;
  layout?: SectionLayout;
  nodes: MindmapNode[];
}

export interface MindmapDocument {
  sections: MindmapSection[];
}

const VALID_STYLES: MindmapStyle[] = ["h1", "h2", "h3", "body", "bullet"];
const VALID_LAYOUTS: SectionLayout[] = ["tree", "compare", "row"];
const VALID_ALIGNS: TextAlign[] = ["left", "center", "right"];

const BRANCH_THEMES = [
  "#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8",
  "#ddd6fe", "#fed7aa", "#fecaca", "#a7f3d0",
];

const GAP_X = 28;          // horizontal gap between sibling subtrees inside a tree
const GAP_Y = 88;          // vertical gap between levels inside a tree
const SECTION_GAP_Y = 140; // vertical gap between sections
const COMPARE_GAP = 160;   // gap between the two sides of a compare layout
const ROW_GAP = 96;        // gap between siblings in a row layout
const TITLE_HEIGHT = 56;   // section-title shape height + breathing room

interface Preset {
  fontSize: number;
  bold: boolean;
  bullet: boolean;
  w: number;
  h: number;
}

function presetFor(style: MindmapStyle | undefined, depth: number): Preset {
  const s: MindmapStyle = style ?? (depth === 0 ? "h1" : depth === 1 ? "h2" : "body");
  switch (s) {
    case "h1": return { fontSize: 24, bold: true, bullet: false, w: 280, h: 96 };
    case "h2": return { fontSize: 18, bold: true, bullet: false, w: 220, h: 76 };
    case "h3": return { fontSize: 16, bold: true, bullet: false, w: 200, h: 64 };
    case "bullet": return { fontSize: 14, bold: false, bullet: true, w: 240, h: 52 };
    case "body":
    default: return { fontSize: 14, bold: false, bullet: false, w: 200, h: 60 };
  }
}

// ---------- measure ----------

function measureSubtree(node: MindmapNode, depth: number): { width: number; height: number } {
  const preset = presetFor(node.style, depth);
  const children = node.children ?? [];
  if (!children.length) return { width: preset.w, height: preset.h };
  let totalChildW = 0;
  let maxChildH = 0;
  for (const c of children) {
    const m = measureSubtree(c, depth + 1);
    totalChildW += m.width;
    maxChildH = Math.max(maxChildH, m.height);
  }
  totalChildW += (children.length - 1) * GAP_X;
  return {
    width: Math.max(preset.w, totalChildW),
    height: preset.h + GAP_Y + maxChildH,
  };
}

// ---------- layout one subtree ----------

interface TreeLayout {
  shapes: Shape[];
  edges: Edge[];
  width: number;
  height: number;
}

function layoutTree(node: MindmapNode, originX: number, originY: number, branchColor?: string): TreeLayout {
  const shapes: Shape[] = [];
  const edges: Edge[] = [];

  function place(
    node: MindmapNode,
    x: number,
    y: number,
    depth: number,
    branch: string | undefined,
  ): string {
    const subtree = measureSubtree(node, depth);
    const preset = presetFor(node.style, depth);
    const cx = x + subtree.width / 2;
    const align: TextAlign = node.align ?? (preset.bullet ? "left" : "center");
    const id = newId("s_");

    let kind: ShapeKind;
    if (depth === 0 && !branch) kind = "ellipse";
    else if (preset.bullet) kind = "text";
    else kind = "rect";

    const myColor = depth === 0 && !branch ? "#ffffff" : branch ?? BRANCH_THEMES[0];

    shapes.push({
      id, kind,
      x: cx - preset.w / 2,
      y,
      w: preset.w,
      h: preset.h,
      text: node.label,
      fill: kind === "text" ? "transparent" : myColor,
      stroke: kind === "text" ? "transparent" : depth === 0 && !branch ? "#0f172a" : "#1f2937",
      fontSize: preset.fontSize,
      bold: preset.bold || undefined,
      bullet: preset.bullet || undefined,
      textAlign: align,
    });

    let cursor = x;
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const cm = measureSubtree(child, depth + 1);
      const childBranch =
        depth === 0 && !branch
          ? BRANCH_THEMES[i % BRANCH_THEMES.length]
          : branch;
      const childId = place(child, cursor, y + preset.h + GAP_Y, depth + 1, childBranch);
      edges.push({
        id: newId("e_"),
        from: id,
        to: childId,
        fromAnchor: "bottom",
        toAnchor: "top",
      });
      cursor += cm.width + GAP_X;
    }
    return id;
  }

  const root = measureSubtree(node, 0);
  place(node, originX, originY, 0, branchColor);
  return { shapes, edges, width: root.width, height: root.height };
}

// ---------- layout one section ----------

interface SectionLayoutResult {
  shapes: Shape[];
  edges: Edge[];
  width: number;
  height: number;
}

function layoutSection(section: MindmapSection, x: number, y: number): SectionLayoutResult {
  const out: SectionLayoutResult = { shapes: [], edges: [], width: 0, height: 0 };
  const layout = section.layout ?? "tree";

  const contentY = section.title ? y + TITLE_HEIGHT : y;

  if (layout === "tree") {
    const node = section.nodes[0];
    if (!node) return out;
    const t = layoutTree(node, x, contentY);
    out.shapes.push(...t.shapes);
    out.edges.push(...t.edges);
    out.width = t.width;
    out.height = t.height;
  } else {
    // compare or row: subtrees side-by-side, no connections between them.
    const gap = layout === "compare" ? COMPARE_GAP : ROW_GAP;
    let cursorX = x;
    let maxH = 0;
    for (let i = 0; i < section.nodes.length; i++) {
      const child = section.nodes[i];
      // For multi-root sections, each top-level node gets its own theme color.
      const theme = BRANCH_THEMES[i % BRANCH_THEMES.length];
      const t = layoutTree(child, cursorX, contentY, theme);
      out.shapes.push(...t.shapes);
      out.edges.push(...t.edges);
      cursorX += t.width + gap;
      maxH = Math.max(maxH, t.height);
    }
    out.width = Math.max(0, cursorX - x - gap);
    out.height = maxH;
  }

  if (section.title) {
    // Title shape centered above the section's content.
    const titleW = Math.max(280, out.width);
    out.shapes.unshift({
      id: newId("s_"),
      kind: "text",
      x: x + (out.width - titleW) / 2,
      y,
      w: titleW,
      h: 40,
      text: section.title,
      fill: "transparent",
      stroke: "transparent",
      fontSize: 20,
      bold: true,
      textAlign: "center",
    });
    out.height += TITLE_HEIGHT;
  }

  return out;
}

// ---------- layout a whole document (one or more sections) ----------

export function layoutImport(doc: MindmapDocument): { shapes: Shape[]; edges: Edge[] } {
  const allShapes: Shape[] = [];
  const allEdges: Edge[] = [];
  let cursorY = 0;
  for (const section of doc.sections) {
    if (!section.nodes || section.nodes.length === 0) continue;
    const r = layoutSection(section, 0, cursorY);
    allShapes.push(...r.shapes);
    allEdges.push(...r.edges);
    cursorY += r.height + SECTION_GAP_Y;
  }
  return { shapes: allShapes, edges: allEdges };
}

// Kept for back-compat — wraps the doc layout in a single tree section.
export function layoutMindmap(
  root: MindmapNode,
  originX = 0,
  originY = 0,
): { shapes: Shape[]; edges: Edge[] } {
  const t = layoutTree(root, originX, originY);
  return { shapes: t.shapes, edges: t.edges };
}

// ---------- sanitize ----------

function sanitizeNode(value: unknown): MindmapNode | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { label?: unknown; style?: unknown; align?: unknown; children?: unknown };
  if (typeof v.label !== "string" || !v.label.trim()) return null;
  const children: MindmapNode[] = [];
  if (Array.isArray(v.children)) {
    for (const c of v.children) {
      const sc = sanitizeNode(c);
      if (sc) children.push(sc);
    }
  }
  const style =
    typeof v.style === "string" && VALID_STYLES.includes(v.style as MindmapStyle)
      ? (v.style as MindmapStyle)
      : undefined;
  const align =
    typeof v.align === "string" && VALID_ALIGNS.includes(v.align as TextAlign)
      ? (v.align as TextAlign)
      : undefined;
  return { label: v.label.trim().slice(0, 200), style, align, children };
}

export function sanitizeImport(value: unknown): MindmapDocument | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { sections?: unknown };

  // New sections-based form.
  if (Array.isArray(v.sections)) {
    const sections: MindmapSection[] = [];
    for (const raw of v.sections) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as { title?: unknown; layout?: unknown; nodes?: unknown };
      const layout: SectionLayout =
        typeof s.layout === "string" && VALID_LAYOUTS.includes(s.layout as SectionLayout)
          ? (s.layout as SectionLayout)
          : "tree";
      const nodes: MindmapNode[] = [];
      if (Array.isArray(s.nodes)) {
        for (const n of s.nodes) {
          const sn = sanitizeNode(n);
          if (sn) nodes.push(sn);
        }
      }
      if (nodes.length === 0) continue;
      const title =
        typeof s.title === "string" && s.title.trim()
          ? s.title.trim().slice(0, 120)
          : undefined;
      sections.push({ title, layout, nodes });
    }
    if (sections.length === 0) return null;
    return { sections };
  }

  // Legacy single-tree form — wrap it as a single tree section.
  const single = sanitizeNode(value);
  if (single) return { sections: [{ layout: "tree", nodes: [single] }] };
  return null;
}

// Back-compat: sanitizeMindmap returns just the first node of a single-tree
// import. Kept as a transitional API; new callers should use sanitizeImport.
export function sanitizeMindmap(value: unknown): MindmapNode | null {
  return sanitizeNode(value);
}
