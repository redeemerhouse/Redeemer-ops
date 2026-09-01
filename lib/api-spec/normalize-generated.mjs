import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const generatedDirectories = [
  resolve(root, "lib/api-client-react/src/generated"),
  resolve(root, "lib/api-zod/src/generated"),
];

for (const directory of generatedDirectories) {
  for (const file of await readdir(directory)) {
    if (!file.endsWith(".ts")) continue;
    const path = resolve(directory, file);
    const content = await readFile(path, "utf8");
    await writeFile(path, `${content.replace(/\n+$/u, "")}\n`);
  }
}