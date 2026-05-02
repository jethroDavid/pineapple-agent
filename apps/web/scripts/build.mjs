import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const dist = new URL("dist/", root);
const distAssets = new URL("assets/", dist);

await mkdir(distAssets, { recursive: true });
await cp(new URL("public/assets", root), distAssets, { recursive: true });
await cp(new URL("src/styles.css", root), new URL("styles.css", distAssets));

const html = await readFile(new URL("index.html", root), "utf8");
await writeFile(new URL("index.html", dist), html);
