export interface FluxionOptions {
  dynamicDirectory: string;
  host: string;
  port: number;
}

export interface ParsedRequestTarget {
  path: string;
  query: Record<string, string | string[]>;
}

export interface BodyPreview {
  exists: boolean;
  value?: string;
  bytes: number;
  truncated: boolean;
}
