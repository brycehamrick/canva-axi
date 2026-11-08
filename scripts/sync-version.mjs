// Mirrors package.json's version into src/version.ts on `npm version`.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const target = join(root, "src", "version.ts");
const next = `/** Single place for the package version (mirrored into package.json by scripts/sync-version.mjs). */\nexport const VERSION = "${pkg.version}";\n`;
writeFileSync(target, next, "utf8");
console.log(`src/version.ts synced to ${pkg.version}`);
