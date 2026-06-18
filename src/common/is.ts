export const isFn = (o: unknown): o is (...args: any[]) => any => typeof o === 'function';

export const isObject = (o: unknown): o is Record<string, any> => typeof o === 'object' && o !== null;

export const isString = (o: unknown): o is string => typeof o === 'string';

export const isInt = (o: unknown, min: number = -Infinity, max: number = Infinity): o is number =>
  Number.isSafeInteger(o) && (o as number) >= min && (o as number) <= max;
