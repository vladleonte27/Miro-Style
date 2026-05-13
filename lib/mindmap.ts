import type { Edge, Shape, ShapeKind, TextAlign } from "./types";
import { newId } from "./id";

export type MindmapStyle = "h1" | "h2" | "h3" | "body" | "bullet";

export interface MindmapNode {
  label: string;
  style?: MindmapStyle;
  align?: TextAlign;
  children?: MindmapNode[];
}

const VALID_STYLES: MindmapStyle[] = ["h1", "h2", "h3", "body", "bullet"];
const VALID_ALIGNS: TextAlign[] = ["left", "center", "right"];

// Each top-level branch gets one of these as its theme; descendants inherit
// the same color so the whole subtree reads as a single colored cluster.
const BRANCH_THEMES = [
  "#fde68a", // amber
  "#bfdbfe", // blue
  "#bbf7d0", // green
  "#fbcfe8", // pink
  "#ddd6fe", // violet
  "#fed7aa", // orange
  "#fecaca", // red
  "#a7f3d0", // teal
];

const GAP_X = 28;
const GAP_Y = 88;

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

function measureWidth(node: MindmapNode, depth: number): number {
  const preset = presetFor(node.style, depth);
  const children = node.children ?? [];
  if (!children.length) return preset.w;
  const total = children.reduce((sum, c) => sum + measureWidth(c, depth + 1), 0) + (children.length - 1) * GAP_X;
  return Math.max(preset.w, total);
}

export function layoutMindmap(
  root: MindmapNode,
  originX = 0,
  originY = 0,
): { shapes: Shape[]; edges: Edge[] } {
  const shapes: Shape[] = [];
  const edges: Edge[] = [];

  function place(
    node: MindmapNode,
    x: number,
    y: number,
    depth: number,
    branchColor: string | undefined,
  ): string {
    const width = measureWidth(node, depth);
    const cx = x + width / 2;
    const preset = presetFor(node.style, depth);
    const align: TextAlign = node.align ?? (preset.bullet ? "left" : "center");
    const id = newId("s_");

    // Visual variance:
    //  - Depth 0 (root) is always an ellipse so the topic visually anchors.
    //  - Bullet style renders as a *text* shape so it reads as a list item
    //    (transparent fill, no stroke, with the bullet glyph in front of text).
    //  - Everything else is a rect.
    let kind: ShapeKind;
    if (depth === 0) kind = "ellipse";
    else if (preset.bullet) kind = "text";
    else kind = "rect";

    // Root is neutral white; everyone else inherits their top-level branch's
    // theme color. Bullets get transparent fill so the leaves look like notes.
    const myColor = depth === 0 ? "#ffffff" : branchColor ?? BRANCH_THEMES[0];

    shapes.push({
      id,
      kind,
      x: cx - preset.w / 2,
      y,
      w: preset.w,
      h: preset.h,
      text: node.label,
      fill: kind === "text" ? "transparent" : myColor,
      stroke: kind === "text" ? "transparent" : depth === 0 ? "#0f172a" : "#1f2937",
      fontSize: preset.fontSize,
      bold: preset.bold || undefined,
      bullet: preset.bullet || undefined,
      textAlign: align,
    });

    let cursor = x;
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      const cw = measureWidth(child, depth + 1);
      // Pick a new theme color per top-level branch; deeper levels inherit.
      const childBranch =
        depth === 0 ? BRANCH_THEMES[i % BRANCH_THEMES.length] : branchColor;
      const childId = place(child, cursor, y + preset.h + GAP_Y, depth + 1, childBranch);
      edges.push({
        id: newId("e_"),
        from: id,
        to: childId,
        fromAnchor: "bottom",
        toAnchor: "top",
      });
      cursor += cw + GAP_X;
    }
    return id;
  }

  place(root, originX, originY, 0, undefined);
  return { shapes, edges };
}

export function sanitizeMindmap(value: unknown): MindmapNode | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { label?: unknown; style?: unknown; align?: unknown; children?: unknown };
  if (typeof v.label !== "string" || !v.label.trim()) return null;
  const children: MindmapNode[] = [];
  if (Array.isArray(v.children)) {
    for (const c of v.children) {
      const sc = sanitizeMindmap(c);
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
  return {
    label: v.label.trim().slice(0, 200),
    style,
    align,
    children,
  };
}
