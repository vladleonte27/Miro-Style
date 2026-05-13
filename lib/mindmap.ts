import type { Edge, Shape } from "./types";
import { newId } from "./id";

export interface MindmapNode {
  label: string;
  children?: MindmapNode[];
}

const DEPTH_FILLS = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#ddd6fe", "#fed7aa"];

const NODE_W = 200;
const NODE_H = 56;
const GAP_X = 80;
const GAP_Y = 18;

function measure(node: MindmapNode): number {
  const children = node.children ?? [];
  if (!children.length) return NODE_H;
  const total = children.reduce((s, c) => s + measure(c), 0) + (children.length - 1) * GAP_Y;
  return Math.max(NODE_H, total);
}

export function layoutMindmap(
  root: MindmapNode,
  originX = 0,
  originY = 0,
): { shapes: Shape[]; edges: Edge[] } {
  const shapes: Shape[] = [];
  const edges: Edge[] = [];

  function place(node: MindmapNode, x: number, y: number, depth: number): string {
    const height = measure(node);
    const cy = y + height / 2;
    const id = newId("s_");
    shapes.push({
      id,
      kind: depth === 0 ? "ellipse" : "rect",
      x,
      y: cy - NODE_H / 2,
      w: NODE_W,
      h: NODE_H,
      text: node.label,
      fill: DEPTH_FILLS[depth % DEPTH_FILLS.length],
      stroke: "#1f2937",
    });

    let cursor = y;
    for (const child of node.children ?? []) {
      const ch = measure(child);
      const childId = place(child, x + NODE_W + GAP_X, cursor, depth + 1);
      edges.push({ id: newId("e_"), from: id, to: childId });
      cursor += ch + GAP_Y;
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
