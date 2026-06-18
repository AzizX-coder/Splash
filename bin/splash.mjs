#!/usr/bin/env node
/**
 * Splash global launcher.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as fs from "node:fs";
import process from "node:process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");

process.env.SPLASH_HOME = packageRoot;
process.env.FORCE_COLOR = "1";

const distCliPath = resolve(packageRoot, "dist", "examples", "cli.js");
const srcCliPath = resolve(packageRoot, "examples", "cli.ts");

if (fs.existsSync(distCliPath)) {
  // Production (NPM installed): Execute bundled ESM file in-process
  import(pathToFileURL(distCliPath).href).catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  // Local development (Repo checkout): Execute via tsx
  const tsxName = process.platform === "win32" ? "tsx.cmd" : "tsx";
  const tsxCandidates = [
    resolve(packageRoot, "node_modules", ".bin", tsxName),
    resolve(packageRoot, "..", "..", "node_modules", ".bin", tsxName),
    tsxName,
  ];
  let tsxBin = tsxCandidates.find((p) => fs.existsSync(p)) || tsxName;
  
  const result = spawnSync(tsxBin, [srcCliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });
  
  if (result.error && result.error.code === "ENOENT") {
    console.error("Splash: could not locate the tsx runtime.");
    process.exit(127);
  }
  process.exit(result.status ?? 1);
}
