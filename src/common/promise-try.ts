/**
 * For low version of Node.js that does not support `Promise.try`, we can implement it ourselves.
 *
 * Only for async functions.
 */
export function PromiseTry<T extends (...args: any[]) => Promise<any>>(fn: T, ...args: Parameters<T>) {
  return new Promise<ReturnType<T>>((resolve, reject) => {
    // in case `fn` throws synchronously, we catch it and reject the promise
    try {
      fn(...args)
        .then(resolve)
        .catch(reject);
    } catch (error) {
      reject(error);
    }
  });
}
