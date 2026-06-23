import { build } from './build.js';
import { publish } from './publish.js';

if (process.argv.includes('--build')) {
  build();
} else if (process.argv.includes('--publish')) {
  build();
  publish();
}
