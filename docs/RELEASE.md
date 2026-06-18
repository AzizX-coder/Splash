# Splash — npm Release Guide

> One-page checklist for cutting a new npm release of `splash-agent`. Publishing is final (the version number is permanently consumed and the package is unpublishable after 72h), so this is a deliberate sequence — not an automated push.

---

## 0. One-time setup

```bash
# 1. Make sure you're logged in as the splash-agent owner.
npm whoami
npm login

# 2. Enable 2FA on your npm account (npmjs.com → Account → Two-Factor Auth).
#    With 2FA on, npm will prompt for an OTP at publish time.
npm profile enable-2fa auth-and-writes
```

GitHub Actions deploys: store an automation token in repo secrets (`NPM_TOKEN`).
Generate it at https://www.npmjs.com/settings/<user>/tokens with the
**Automation** type so it bypasses 2FA only for `npm publish` from CI.

---

## 1. Choose the version

`package.json` is currently at `2.5.1`. The work in
`feat/splash-engine-rebuild` is a major (rebrand + new packages + new APIs):

| Type | When | Command |
|------|------|---------|
| `patch` | Bug fixes only | `npm version patch` (2.5.1 → 2.5.2) |
| `minor` | Backward-compatible features | `npm version minor` (2.5.1 → 2.6.0) |
| `major` | Breaking change | `npm version major` (2.5.1 → 3.0.0) |
| pre-release | Beta channel | `npm version 3.0.0-beta.1 --no-git-tag-version` |

For this rebrand: **`major` (3.0.0)** is the honest call.

---

## 2. Pre-flight (run from a release branch, never `main`)

```bash
# branch off the merged PR
git checkout main && git pull
git checkout -b release/3.0.0

# script runs the full CI gate, bumps the version, and dry-run packs the tarball
node scripts/release.mjs major --tag latest
```

The script will:

1. Refuse to run with a dirty tree or on `main`.
2. `pnpm install --frozen-lockfile` (deterministic deps).
3. `pnpm run typecheck` (must be 0 errors).
4. `pnpm run test` (currently 288 tests).
5. `pnpm run build` (the `prepare` script runs tsup; `dist/` must be produced).
6. `npm version <bump> --no-git-tag-version`.
7. `npm pack --dry-run` — **review the file list it prints.** Anything you don't want shipped (test fixtures, dev configs) needs to be excluded by `package.json`'s `files` array or `.npmignore`.

The script never publishes on its own.

---

## 3. Verify the tarball

The current `package.json` ships only:

```json
"files": ["bin/", "dist/", "templates/", "README.md", "LICENSE", ".env.example"]
```

Confirm:

- ✅ `bin/splash.mjs` and `bin/healthcheck.mjs` are present
- ✅ `dist/` contains the bundled `examples/cli.js` (entry for `splash`)
- ❌ no `.env` real values, no `~/.splash/config.json`, no test fixtures
- ❌ no `node_modules/`

Spot-check by extracting:

```bash
npm pack
tar -tzf splash-agent-3.0.0.tgz | head -50
rm splash-agent-3.0.0.tgz
```

---

## 4. Tag, push, publish

```bash
# 1. Commit the version bump and tag it (the release script does NOT do this)
git add -A
git commit -m "chore(release): 3.0.0"
git tag -a v3.0.0 -m "Splash 3.0.0 — engine rebuild + rebrand"

# 2. Push to GitHub
git push -u origin release/3.0.0
git push --tags

# 3. Open a release PR, get review, merge to main.

# 4. After merge, on main:
git checkout main && git pull
npm publish --tag latest --access public
#  --tag latest      → installs by default with `npm i splash-agent`
#  --tag next        → opt-in via `npm i splash-agent@next`  (use for betas)
#  --access public   → required the first time for a scoped package
```

npm will prompt for your 2FA OTP. Enter it when asked.

---

## 5. Publish a beta first (recommended for a major)

```bash
node scripts/release.mjs 3.0.0-beta.1 --tag next
# … test the prerelease …
npm publish --tag next --access public

# users opt in:
#   npm i splash-agent@next
#   npm i splash-agent@3.0.0-beta.1

# When promoting beta → stable:
npm dist-tag add splash-agent@3.0.0 latest
```

---

## 6. GitHub Release notes

After the npm publish, cut a GitHub release tied to the tag:

```bash
gh release create v3.0.0 \
  --title "Splash 3.0.0 — engine rebuild" \
  --notes-file CHANGELOG.md \
  --latest
```

Or via the UI: https://github.com/AzizX-coder/Splash/releases/new

---

## 7. Post-publish smoke test

```bash
# In a clean dir, install from the registry and exercise the fast-path:
mkdir /tmp/splash-smoke && cd /tmp/splash-smoke
npm i -g splash-agent@3.0.0
splash version          # should print 3.0.0
splash skills list      # 52 tools/skills, sub-second, no LLM call
splash doctor           # all green
```

If anything is wrong: **don't unpublish unless within the 72h grace window**.
Cut a `3.0.1` patch instead — npm penalizes unpublishing because the version
number is permanently consumed.

---

## 8. Rollback options (in priority order)

1. **`3.0.x` patch** — preferred, fix forward.
2. **`npm dist-tag rm splash-agent@3.0.0 latest`** — un-defaults the bad version without removing it. Users on `latest` go back to the previous version on next install.
3. **`npm unpublish splash-agent@3.0.0`** — only works within 72h of publish. After that, npm requires manual intervention.

---

## Quick reference

```bash
# from a clean release branch:
node scripts/release.mjs major --tag latest

# review the file list, then:
git add -A && git commit -m "chore(release): 3.0.0"
git tag -a v3.0.0 -m "Splash 3.0.0"
git push && git push --tags
npm publish --tag latest --access public
gh release create v3.0.0 --title "Splash 3.0.0" --notes-file CHANGELOG.md --latest
```
