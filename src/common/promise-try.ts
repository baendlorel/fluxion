/**
 * For low version of Node.js that does not support `Promise.try`, we can implement it ourselves.
 *
 * Only for async functions.
 */
export function PromiseTry<T extends (...args: any[]) => any>(fn: T, ...args: Parameters<T>) {
  return new Promise<ReturnType<T>>((resolve, reject) => {
    // in case `fn` throws synchronously, we catch it and reject the promise
    try {
      const r = fn(...args);
      if (r instanceof Promise) {
        r.then(resolve).catch(reject);
      } else {
        resolve(r);
      }
    } catch (error) {
      reject(error);
    }
  });
}
