import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const COMPRESSIBLE = /\.(?:html|js|mjs|css|json|webmanifest|svg|txt|xml|map)$/u;
const MIN_BYTES = 1024;

const [root] = process.argv.slice(2);
if (!root) {
  throw new Error(
    "Pass the build's folder: bun scripts/precompress.ts dist/client"
  );
}

let files = 0;
for (const name of await readdir(root, { recursive: true })) {
  const file = path.join(root, name);
  if (!COMPRESSIBLE.test(file)) {
    continue;
  }
  const { size } = await stat(file);
  if (size < MIN_BYTES) {
    continue;
  }
  const raw = await readFile(file);
  await writeFile(
    `${file}.br`,
    brotliCompressSync(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      },
    })
  );
  await writeFile(`${file}.gz`, gzipSync(raw, { level: 9 }));
  files += 1;
}
console.log(`Precompressed ${files} files in ${root}`);
