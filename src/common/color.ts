const useColor = process.env.FLUXION_COLORS !== '0';

/**
 * Color Control Characters for Terminal (cctl)
 */
export namespace cctl {
  export const reset = useColor ? '\x1b[0m' : '';
  export const bold = useColor ? '\x1b[1m' : '';
  export const dim = useColor ? '\x1b[2m' : '';
  export const italic = useColor ? '\x1b[3m' : '';
  export const underline = useColor ? '\x1b[4m' : '';
  export const blink = useColor ? '\x1b[5m' : '';
  export const inverse = useColor ? '\x1b[7m' : '';

  export const black = useColor ? '\x1b[30m' : '';
  export const red = useColor ? '\x1b[31m' : '';
  export const green = useColor ? '\x1b[32m' : '';
  export const yellow = useColor ? '\x1b[33m' : '';
  export const blue = useColor ? '\x1b[34m' : '';
  export const magenta = useColor ? '\x1b[35m' : '';
  export const cyan = useColor ? '\x1b[36m' : '';
  export const white = useColor ? '\x1b[37m' : '';

  export const brightBlack = useColor ? '\x1b[90m' : '';
  export const brightRed = useColor ? '\x1b[91m' : '';
  export const brightGreen = useColor ? '\x1b[92m' : '';
  export const brightYellow = useColor ? '\x1b[93m' : '';
  export const brightBlue = useColor ? '\x1b[94m' : '';
  export const brightMagenta = useColor ? '\x1b[95m' : '';
  export const brightCyan = useColor ? '\x1b[96m' : '';
  export const brightWhite = useColor ? '\x1b[97m' : '';

  export const bgBlack = useColor ? '\x1b[40m' : '';
  export const bgRed = useColor ? '\x1b[41m' : '';
  export const bgGreen = useColor ? '\x1b[42m' : '';
  export const bgYellow = useColor ? '\x1b[43m' : '';
  export const bgBlue = useColor ? '\x1b[44m' : '';
  export const bgMagenta = useColor ? '\x1b[45m' : '';
  export const bgCyan = useColor ? '\x1b[46m' : '';
  export const bgWhite = useColor ? '\x1b[47m' : '';

  export const bgBrightBlack = useColor ? '\x1b[100m' : '';
  export const bgBrightRed = useColor ? '\x1b[101m' : '';
  export const bgBrightGreen = useColor ? '\x1b[102m' : '';
  export const bgBrightYellow = useColor ? '\x1b[103m' : '';
  export const bgBrightBlue = useColor ? '\x1b[104m' : '';
  export const bgBrightMagenta = useColor ? '\x1b[105m' : '';
  export const bgBrightCyan = useColor ? '\x1b[106m' : '';
  export const bgBrightWhite = useColor ? '\x1b[107m' : '';

  // 'rgb(225, 16, 248)';
  export const purple = useColor ? '\x1b[38;2;225;16;248m' : '';
  // 'rgb(248, 147, 16)';
  export const orange = useColor ? '\x1b[38;2;248;147;16m' : '';
  export const darkGreen = useColor ? '\x1b[38;2;22;101;52m' : '';
  export const claude = useColor ? '\x1b[38;2;217;119;87m' : '';
  export const deepseek = useColor ? '\x1b[38;2;57;100;254m' : '';
  export const gpt = useColor ? '\x1b[38;2;41;60;77m' : '';
}
