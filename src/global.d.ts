export type otherstring = string & {};

export interface InjectionConfig {
  /**
   * Name that you can use to refer to this database in your handlers.
   * It should be unique across all databases and should not contain leading or trailing whitespace.
   * It is recommended to use simple and descriptive names, such as "mainDb" or "redisCache".
   */
  name: string;

  /**
   * The `.mjs` path that exports the factory function to create the instance. The factory function should be the default export and can be async.
   * ```typescript
   * // .mjs can be like this:
   * export default function createDb() {
   *   // create and return your database instance here, e.g. a connection pool
   * }
   * // or async
   * export default async function createDb() {
   *   // create and return your database instance here, e.g. a connection pool
   * }
   *
   * ```
   */
  modulePath: string;
}

declare global {
  function $throw(message: string): never;
}
