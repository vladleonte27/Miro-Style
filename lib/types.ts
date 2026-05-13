export type ShapeKind = "rect" | "ellipse" | "diamond" | "text";

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
}

export interface Edge {
  id: string;
  from: string;
  to: string;
}

export interface Board {
  id: string;
  name: string;
  shapes: Shape[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
}
