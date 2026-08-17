import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "api");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const apiNodeModules = resolve(dirname(fileURLToPath(import.meta.url)), "..", "node_modules");

await build({
  entryPoints: [resolve(apiDir, "[[...route]].ts")],
  outfile: resolve(root, "api", "[[...route]].js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle",
  sourcemap: false,
  legalComments: "none",
  nodePaths: [apiNodeModules]
});

console.log("Bundled API function -> api/[[...route]].js");
