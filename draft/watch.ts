import fs from 'node:fs';
import path from 'node:path';

const watched = path.join(import.meta.dirname, '..', 'dist');
console.log('start watching');
fs.watch(watched, { recursive: true }, (eventType, filename) => {
  console.log(`[${new Date().toISOString()}] ${eventType} - ${filename}`);
});
