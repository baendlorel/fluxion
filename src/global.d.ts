declare global {
  function $throw(message: string): never;
}

export type otherstring = string & {};
