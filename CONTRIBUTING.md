# Contributing to Trailline

## Setup

```bash
npm install
```

Node 18+ is required (CI runs on 18, 20, and 22).

## Before you push

```bash
npm run lint          # ESLint
npm run format        # Prettier (write)
npm run format:check  # Prettier (verify only, as CI runs it)
```

## Conventions

These are enforced in CI on every pull request.

### Branch names

`<type>/<slug>` — lowercase, dashes for spaces.

```
feat/sql-composer
fix/empty-view-crash
docs/readme-teaser
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`, `perf`, `revert`.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `<type>: <summary>`, summary in lowercase, imperative mood.

```
feat: add sql composer
fix: handle empty view without throwing
docs: update readme teaser
```

Same allowed types as branches. Commits are checked with `commitlint`.

### Pull requests

- **Title** follows the same `<type>: <summary>` format as commits (checked in CI).
- **Description** fills in the PR template: what & why, how, and the checklist.
- Keep PRs focused; one logical change per PR.

## Releasing

Publishing to npm is automated: cut a GitHub Release (tag `vX.Y.Z`), and the
`Publish` workflow runs `npm publish` with provenance. Bump the version in
`package.json` in the release PR beforehand.
