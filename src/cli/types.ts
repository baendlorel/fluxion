export type FluxionCommand =
  | {
      options: Array<{ option: 'config'; value: string }>;
      command: null;
    }
  | {
      options: [];
      command: 'status';
    }
  | {
      options: [];
      command: 'stop';
    }
  | {
      options: [];
      command: 'logs';
    };
