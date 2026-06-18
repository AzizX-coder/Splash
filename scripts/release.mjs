#!/usr/bin/env node
/**
 * Splash npm release helper.
 *
 * Runs the full pre-publish gauntlet: clean, install, typecheck, tests, build,
 * version-bump, dry-run pack, then prints the exact `npm publish` command for
 * the operator to run. Never publishes on its own — publishing is a one-way
 * action against the public registry and must be a human decision.
 *
 * Usage:
 *   node scripts/release.mjs <patch|minor|major|x.y.z> [--tag latest|next|beta]
 *
 * Examples:
 *   node scripts/release.mjs minor             # 2.5.1 -> 2.6.0, tag latest
 *   node scripts/release.mjs major             # 2.5.1 -> 3.0.0
 *   node scripts/release.mjs 3.0.0-beta.1 --tag beta
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const bump = args[0];
const tag = (() => {
  const i = args.indexOf("--tag");
  return i >= 0 ? args[i + 1] : "latest";
})();

if (!bump) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major|x.y.z> [--tag latest|next|beta]");
  process.exit(1);
}

const sh = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
};

const out = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

console.log("== Splash release pipeline ==");

// 1. Refuse to release from a dirty tree.
const status = out("git status --porcelain");
if (status) {
  console.error("[ERR] Working tree not clean. Commit or stash first:\n" + status);
  process.exit(1);
}

// 2. Refuse to release directly from main (release from a tag-prep branch).
const branch = out("git rev-parse --abbrev-ref HEAD");
if (branch === "main" || branch === "master") {
  console.error(`[ERR] On '${branch}'. Release from a release branch (e.g. release/3.0.0).`);
  process.exit(1);
}

// 3. Reproduce the full CI gate locally.
sh("pnpm install --frozen-lockfile");
sh("pnpm run typecheck");
sh("pnpm run test");
sh("pnpm run build");

// 4. Bump version (no git tag yet — npm version normally tags; we want to
//    review the diff before tagging). pnpm version supports semver keywords.
sh(`npm version ${bump} --no-git-tag-version`);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const newVersion = pkg.version;
console.log(`\n>> bumped to ${newVersion}`);

// 5. Pack (dry-run) so the operator sees exactly what will go to npm.
sh("npm pack --dry-run");

// 6. Print the operator's next steps. We refuse to publish from this script.
console.log(
  "\n== Ready to publish ==\n" +
    "  Review the file list above. If correct:\n\n" +
    `  1.  git add -A && git commit -m \"chore(release): ${newVersion}\"\n` +
    `  2.  git tag -a v${newVersion} -m \"Splash ${newVersion}\"\n` +
    `  3.  git push && git push --tags\n` +
    `  4.  npm publish --tag ${tag} --access public\n` +
    "\nPublishing is final (only unpublishable within 72h, and the version is permanently consumed). Do it deliberately.",
);
