# Splash — Release Checklist

Before running `npm publish`, complete these steps:

## Pre-publish Checklist

- [ ] **1. Set `"private": false`** in `package.json` (currently `true` to prevent accidental publish)
- [ ] **2. Verify npm auth** — run `npm whoami` to confirm you're logged into the correct npm account
- [ ] **3. Verify `name` availability** — run `npm view splash` to check if the package name is taken. If taken, update `"name"` in `package.json` (e.g., `@alpclaw/splash` or `splash-agent`)
- [ ] **4. Add real API key for smoke test** — run `splash init` followed by `splash "hello"` to verify end-to-end flow
- [ ] **5. Final CI green** — ensure the GitHub Actions CI workflow passes on `main` before publishing

## Publish Steps

```bash
# 1. Ensure clean working tree
git status  # should be clean

# 2. Bump version
npm version patch  # or minor/major

# 3. Run prepublishOnly checks
pnpm run prepublishOnly

# 4. Dry-run publish
npm pack --dry-run  # review tarball contents

# 5. Publish
npm publish --access public

# 6. Push tags
git push origin main --tags
```

## Post-publish Verification

```bash
# Install globally and test
npm install -g splash
splash --help
splash init
```

## Known Remaining Items

- Package name `splash` may be taken on npm — check availability
- Bot webhook tests require live platform credentials
- README test counts should be updated after adding more tests
- Consider adding `@types/node` as a peer dependency for TypeScript consumers
