export type otherstring = string & {};

export interface InjectionConfig {
  /**
   * Name that you can use to refer to this injected dependency in your handlers.
   */
  name: string;

  /**
   * The `.mjs` path that exports the factory function to create the dependency instance.
   */
  modulePath: string;
}
