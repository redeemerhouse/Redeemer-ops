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
    const compatible = directory.includes("api-zod")
      ? content
        .replace(/\bzod\.email\(\)/gu, "zod.string().email()")
        .replace(/\bzod\.int\(\)/gu, "zod.number().int()")
      : content;
    await writeFile(path, `${compatible.replace(/\n+$/u, "")}\n`);
  }
}