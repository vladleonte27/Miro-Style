import type { Edge, Shape, TextAlign } from "./types";
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

const DEPTH_FILLS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#ddd6fe", "#fed7aa"];

const NODE_W = 200;
const NODE_H_BASE = 64;
const GAP_X = 24;
const GAP_Y = 84;

function presetFor(style: MindmapStyle | undefined, depth: number) {
  const s: MindmapStyle = style ?? (depth === 0 ? "h1" : depth === 1 ? "h2" : "body");
  switch (s) {
    case "h1": return { fontSize: 22, bold: true, bullet: false, height: 80 };
    case "h2": return { fontSize: 18, bold: true, bullet: false, height: 72 };
    case "h3": return { fontSize: 16, bold: true, bullet: false, height: 64 };
    case "bullet": return { fontSize: 14, bold: false, bullet: true, height: 56 };
    case "body":
    default: return { fontSize: 14, bold: false, bullet: false, height: 60 };
  }
}

function measureWidth(node: MindmapNode): number {
  const children = node.children ?? [];
  if (!children.length) return NODE_W;
  const total = children.reduce((sum, c) => sum + measureWidth(c), 0) + (children.length - 1) * GAP_X;
  return Math.max(NODE_W, total);
}

export function layoutMindmap(
  root: MindmapNode,
  originX = 0,
  originY = 0,
): { shapes: Shape[]; edges: Edge[] } {
  const shapes: Shape[] = [];
  const edges: Edge[] = [];

  function place(node: MindmapNode, x: number, y: number, depth: number): string {
    const width = measureWidth(node);
    const cx = x + width / 2;
    const preset = presetFor(node.style, depth);
    const align: TextAlign = node.align ?? (preset.bullet ? "left" : "center");
    const id = newId("s_");
    shapes.push({
      id,
      kind: depth === 0 ? "ellipse" : "rect",
      x: cx - NODE_W / 2,
      y,
      w: NODE_W,
      h: Math.max(NODE_H_BASE, preset.height),
      text: node.label,
      fill: DEPTH_FILLS[depth % DEPTH_FILLS.length],
      stroke: "#1f2937",
      fontSize: preset.fontSize,
      bold: preset.bold || undefined,
      bullet: preset.bullet || undefined,
      textAlign: align,
    });

    let cursor = x;
    for (const child of node.children ?? []) {
      const cw = measureWidth(child);
      const childId = place(child, cursor, y + Math.max(NODE_H_BASE, preset.height) + GAP_Y, depth + 1);
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

  place(root, originX, originY, 0);
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
