/** Host-only inspection data. Never used to validate or run inference. */
export interface OnnxTensor {
  name: string;
  shape: (number | string | null)[] | null;
  dataType: number | null;
  origin: "disk" | "inferred" | "unknown";
}
export interface OnnxWeight {
  name: string;
  shape: number[];
  dataType: number;
  byteSize: number | null;
  external: boolean;
}
export interface OnnxNode {
  id: number;
  name: string;
  opType: string;
  domain: string;
  inputs: string[];
  outputs: string[];
  attributes: Record<string, unknown>;
}
export interface OnnxGraph {
  name: string;
  irVersion: number;
  producer: string;
  opsets: Record<string, number>;
  metadata: Record<string, string>;
  nodes: OnnxNode[];
  edges: { tensor: string; source: number | null; target: number; inputIndex: number }[];
  inputs: string[];
  outputs: string[];
  tensors: OnnxTensor[];
  initializers: OnnxWeight[];
}
