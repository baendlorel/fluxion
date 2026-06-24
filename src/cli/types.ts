export type FluxionCommand =
  | {
      options: Array<{ option: 'config'; value: string }>;
      name: null;
    }
  | {
      options: [];
      name: 'status';
    }
  | {
      options: [];
      name: 'stop';
    }
  | {
      options: [];
      name: 'logs';
    };
