import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(root, '..');
const output = resolve(projectRoot, 'dist');

if (dirname(output) !== projectRoot || relative(projectRoot, output).split(sep)[0] !== 'dist') {
  throw new Error('Percorso di output non valido.');
}

const files = [
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'sw.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon.svg',
  'src/app.js',
  'src/core.js',
  'src/ink-engine-adapters.js',
  'src/ink-engine.js',
  'src/ink.js',
  'src/live-ink.js',
  'src/pen-preview.js',
  'src/pen-training.js',
  'src/perf.js',
  'src/size-picker.js',
  'src/storage.js',
  'src/tool-cursor.js',
  'src/tool-settings.js',
  'vendor/licenses/paperjs-MIT.txt',
  'vendor/licenses/signature_pad-MIT.txt',
  'vendor/paper-core-0.16.0.js',
  'vendor/signature_pad-5.1.4.js'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  const destination = join(output, file);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(projectRoot, file), destination);
}
console.log(`Sito pronto in ${relative(projectRoot, output)} (${files.length} file).`);
