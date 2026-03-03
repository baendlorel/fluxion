export type otherstring = string & {};

declare global {
  function $throw(message: string): never;
}
