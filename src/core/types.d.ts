export interface NormalizedRequest {
  method: string;
  ip: string;
  url: URL;
  query: Record<string, string | string[]>;
}
