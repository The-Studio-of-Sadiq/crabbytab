# Contributing to CrabbyTab

Thanks for your interest in improving CrabbyTab. Contributions can include bug
fixes, tournament workflow improvements, accessibility work, documentation,
tests, and ideas for new features.

## Before you start

- Check the existing issues and pull requests for related work.
- For a substantial change, open an issue first so the scope and approach can
  be discussed before you invest time in implementation.
- For security issues, follow the private reporting guidance in
  [SECURITY.md](./SECURITY.md) instead of opening a public issue.

## Set up your development environment

1. Install Node.js 22 and npm.
2. Fork and clone the repository.
3. Install dependencies with `npm install`.
4. Copy `.env.example` to `.env.local` and configure Firebase or SMTP settings
   only if needed for the feature you are working on.
5. Start the development server with `npm run dev`.

## Make and verify a change

- Create a focused branch from the current default branch.
- Keep changes scoped to one fix or feature and follow the existing TypeScript,
  React, and formatting patterns.
- Add or update tests for behavior changes. Keep tournament formats,
  calculations, and data handling covered where practical.
- Update user or developer documentation when behavior or setup changes.
- Before opening a pull request, run:

  ```sh
  npm test
  npm run build
  ```

  If one of these cannot be run, explain why and include any checks you did run.

## Open a pull request

- Use a clear title and describe the problem and solution.
- Include relevant issue links, test results, and screenshots for visible UI
  changes.
- Call out any configuration, data, or migration implications.
- Be responsive to review feedback and keep the pull request up to date.

By submitting a contribution, you agree that it may be distributed under the
project's [AGPL-3.0-or-later license](./LICENSE). Keep third-party code and
assets properly licensed and attributed.
