export namespace whether {
  export const isObject = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  };
}

export namespace expect {
  export function isObject<T = Record<string, unknown>>(o: unknown, message: string): asserts o is T {
    if (typeof o !== 'object' || o === null) {
      throw new Error(message);
    }
  }

  export function isString(s: unknown, message: string): asserts s is string {
    if (typeof s !== 'string') {
      throw new Error(message);
    }
  }

  export function isNumber(n: unknown, message: string): asserts n is number {
    if (typeof n !== 'number') {
      throw new Error(message);
    }
  }

  export function isObjectArray<T = Record<string, unknown>>(arr: unknown, message: string): asserts arr is T[] {
    if (!Array.isArray(arr) || arr.some((item) => typeof item !== 'object' || item === null)) {
      throw new Error(message);
    }
  }
}
