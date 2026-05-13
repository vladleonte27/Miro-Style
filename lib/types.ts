export type ShapeKind = "rect" | "ellipse" | "diamond" | "text" | "image";
export type Anchor = "top" | "right" | "bottom" | "left";
export type TextAlign = "left" | "center" | "right";

export interface Shape {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fill: string;
  stroke: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  highlight?: boolean;
  highlightColor?: string;
  textAlign?: TextAlign;
  bullet?: boolean;
  src?: string;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
  fromAnchor?: Anchor;
  toAnchor?: Anchor;
}

export interface Board {
  id: string;
  name: string;
  shapes: Shape[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
}
