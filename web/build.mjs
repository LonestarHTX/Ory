// Bundles the web UI into ../ory/static. The output is committed so the work
// machine needs only Python and a browser.
import { copyFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: { app: "src/main.js" },
  bundle: true,
  format: "esm",
  target: ["chrome110", "safari16", "firefox115"],
  outdir: "../ory/static",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  legalComments: "none",
  logLevel: "info",
};

await copyFile("src/index.html", "../ory/static/index.html");
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
