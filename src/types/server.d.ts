export interface FluxionOptions {
  /**
   * The directory where dynamic files (e.g. uploaded files) will be stored. It will be created if it doesn't exist.
   * It is recommended to use an empty directory that is not used for any other purpose, to avoid potential conflicts or security issues.
   */
  dir: string;

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
