import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function main() {
  const p = join(__dirname, 'assets');
  console.log('rmSync', p);
  rmSync(p, { recursive: true, force: true });

  setTimeout(() => {
    mkdirSync(p);
    writeFileSync(
      join(__dirname, 'assets', 'aaa.ts'),
      `import { defineFluxionModule } from '../../../src/index.js';
      
      export default defineFluxionModule({
        handler: async (req) => {
          return req.url.pathname + '成功';
        },
      });`,
      'utf-8',
    );
  }, 1000);
}
main();
