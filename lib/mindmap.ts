import type { Edge, Shape } from "./types";
import { newId } from "./id";

export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

const DEPTH_FILLS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#ddd6fe", "#fed7aa"];

const NODE_W = 184;
const NODE_H = 64;
const GAP_X = 24; // horizontal between sibling subtrees
const GAP_Y = 84; // vertical between levels

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
    const id = newId("s_");
    shapes.push({
      id,
      kind: depth === 0 ? "ellipse" : "rect",
      x: cx - NODE_W / 2,
      y,
      w: NODE_W,
      h: NODE_H,
      text: node.label,
      fill: DEPTH_FILLS[depth % DEPTH_FILLS.length],
      stroke: "#1f2937",
      bold: depth === 0,
      fontSize: depth === 0 ? 16 : 14,
    });

    let cursor = x;
    for (const child of node.children ?? []) {
      const cw = measureWidth(child);
      const childId = place(child, cursor, y + NODE_H + GAP_Y, depth + 1);
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
  const v = value as { label?: unknown; children?: unknown };
  if (typeof v.label !== "string" || !v.label.trim()) return null;
  const children: MindmapNode[] = [];
  if (Array.isArray(v.children)) {
    for (const c of v.children) {
      const sc = sanitizeMindmap(c);
      if (sc) children.push(sc);
    }
  }
  return { label: v.label.trim().slice(0, 80), children };
}
