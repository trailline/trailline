# Contributing to Trailline

## Setup

```bash
npm install
```

Node 18+ is required (CI runs on 18, 20, and 22).

## Before you push

```bash
npm test              # node:test, run as CI runs it
npm run lint          # ESLint
npm run format        # Prettier (write)
npm run format:check  # Prettier (verify only, as CI runs it)
npm run check:package # Assert the tarball still contains the CLI
```

## Repo layout

```
index.js              Executable shim; everything real lives in src/
src/cli.js            Argument dispatch and exit-code handling
src/commands/         One module per command: source, check, view, sql
src/graph/            The file format: schema, expressions, reading the graph
test/                 node:test suites; test/fixtures/ holds the format contract
scripts/              Repo maintenance, not shipped
```

Two rules hold the shape:

- **Runtime dependencies are capped at two.** Everything else comes from the
  standard library. A new dependency is a discussion, not a commit.
- **`files` in `package.json` is an allowlist.** New shipped directories must
  be added there, and `npm run check:package` fails loudly when they are not.

## Command surface

Each command module exports `name`, `summary`, `usage`, `options` (a
`node:util` `parseArgs` config) and `run`. Exit codes are part of the
contract: `0` did the job, `1` ran but failed, `2` was invoked wrongly.

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
