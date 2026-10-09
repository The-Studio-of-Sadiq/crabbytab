# AGENTS.md

## 1. Project Overview

**CrabbyTab** is a free, serverless debate-tournament management platform inspired by Tabbycat. Its goal is to make running fair, accessible debate tournaments possible without expensive hosting infrastructure.

The application should prioritize:

- Fair and reproducible tournament draws.
- Accurate management of tournaments, teams, speakers, adjudicators, venues, and rounds.
- Local-first computation wherever practical.
- Minimal infrastructure and operational costs.
- Reliable data handling and recovery from errors.
- A responsive, accessible, and intuitive user interface.
- Maintainable, strongly typed code.

Before implementing a feature, inspect the existing codebase to understand its current architecture and behavior. Do not assume that every feature associated with Tabbycat already exists in CrabbyTab.

## 2. Technology Stack

Use the existing stack and installed dependencies unless a change is explicitly justified.

- **Framework:** Next.js 15
- **UI:** React 19
- **Language:** TypeScript
- **Styling:** Tailwind CSS 3
- **Backend and data services:** Firebase
- **Icons:** lucide-react
- **CSV parsing:** PapaParse
- **Utility libraries:** clsx, tailwind-merge
- **Testing:** Vitest
- **Package management:** npm, with `package-lock.json` as the authoritative npm lockfile

Do not introduce a new framework, UI library, database, or state-management dependency without a clear technical need.

The repository also contains a `bun.lock` file. Inspect the project's existing setup before changing package-manager conventions. Do not regenerate or remove lockfiles casually.

## 3. Initial Repository Inspection

Before making changes:

1. Read `package.json` and identify the available scripts.
2. Inspect `src/` to understand the application structure, routes, components, utilities, and existing tests.
3. Review `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, and `vitest.config.ts` when relevant.
4. Review `.env.example` to understand the required environment variables.
5. Inspect `firestore.rules` before changing Firebase access patterns or database behavior.
6. Search for existing implementations before introducing new abstractions or duplicating functionality.
7. Check the current Git diff and avoid overwriting unrelated user changes.

Treat the existing implementation as the source of truth when this document and the code disagree. Preserve established conventions unless correcting a documented defect or implementing an intentional architectural change.

## 4. Development Commands

Use the commands already defined in `package.json`.

```bash
npm ci
npm run dev
npm run build
npm run test
npm run lint
```

The development server uses port `3000`.

Important:

- `npm ci` installs dependencies from the committed npm lockfile.
- `npm run dev` starts the local development server.
- `npm run build` checks whether the application can be built for production.
- `npm run test` executes the Vitest test suite.
- `npm run lint` invokes the repository's configured lint command.

The existing lint script uses `next lint`. If that command is incompatible with the installed Next.js version, investigate and correct the project configuration rather than silently skipping linting.

Run the most relevant tests after every meaningful change. Run the production build for substantial application, routing, configuration, or type-related changes.

Never claim that tests, linting, or builds passed unless they were actually executed and completed successfully.

## 5. Architecture and Design Principles

### 5.1 Local-first computation

Keep computation local to the application whenever possible.

Tournament draws, allocation algorithms, standings calculations, validation, and other deterministic business logic should not require a remote service unless the existing architecture or the feature's requirements make that necessary.

- Separate computational logic from React components.
- Prefer deterministic, testable functions.
- Avoid unnecessary network requests.
- Avoid introducing paid APIs or infrastructure requirements.
- Keep expensive computation off the critical rendering path when appropriate.
- Consider practical browser memory and execution-time constraints for larger tournaments.

Do not interpret local-first as permission to expose private tournament data or bypass authentication and authorization.

### 5.2 Separation of concerns

Keep responsibilities clearly separated:

- UI components render information and handle user interactions.
- Business logic implements tournament rules and calculations.
- Data-access code handles Firebase or other persistence mechanisms.
- Validation code checks inputs and domain invariants.
- Tests verify behavior independently of the UI where possible.

Follow the repository's existing directory structure. Avoid moving large portions of the application merely to enforce a preferred architecture.

### 5.3 Server and client boundaries

CrabbyTab uses Next.js App Router conventions if present in the existing implementation.

- Keep components server-rendered by default when possible.
- Use `"use client"` only when client-side interactivity, browser APIs, or client-side state require it.
- Do not access browser-only APIs during server rendering.
- Avoid passing non-serializable values across server/client component boundaries.
- Keep secrets and privileged operations out of client bundles.
- Avoid unnecessary client-side JavaScript.

Verify the actual routing structure before introducing or modifying pages.

## 6. TypeScript and Code Quality

Write readable, maintainable, strongly typed TypeScript.

- Avoid `any`; use explicit types, generics, or `unknown` with appropriate narrowing.
- Avoid unsafe type assertions unless justified.
- Use interfaces or type aliases consistently with the existing codebase.
- Prefer small functions with explicit responsibilities.
- Use meaningful names for variables, functions, types, and components.
- Remove dead code and unused imports introduced by your changes.
- Handle errors explicitly rather than swallowing exceptions.
- Avoid duplicating existing logic.
- Prefer immutable transformations where they improve clarity and correctness.
- Do not add abstractions for hypothetical future requirements.

Do not weaken TypeScript settings, suppress errors globally, or disable lint rules just to make a change pass.

Comments should explain non-obvious reasoning, domain constraints, or intentional trade-offs rather than restating the code.

## 7. Tournament Domain Integrity

Tournament operations are the core of CrabbyTab. Treat tournament data and competition rules as domain-critical.

### 7.1 Draw generation

When modifying draw generation:

- Enforce the tournament format and configured draw constraints.
- Validate team and participant eligibility before generating a draw.
- Respect the relevant venue, room-capacity, adjudicator, and availability constraints when supported by the tournament format.
- Avoid assigning the same team or participant to multiple simultaneous debates.
- Avoid duplicate room or adjudicator assignments within the same round when the rules prohibit them.
- Preserve applicable conflict-of-interest restrictions.
- Respect bye rules and odd-team handling defined by the active tournament format.
- Apply side-allocation and side-balance rules where applicable.
- Do not silently discard teams or participants that cannot be assigned.
- Clearly report unsatisfied constraints when a valid draw cannot be generated.

Never silently relax a hard constraint to produce a result.

If a tournament format permits exceptions, implement them explicitly and document the behavior.

### 7.2 Fairness and reproducibility

Fairness is a core product requirement.

- Make draw generation deterministic when supplied with the same inputs and random seed, where practical.
- If randomness is required, use an explicit and testable random source.
- Keep hard constraints separate from optimization preferences.
- Distinguish a valid draw from an optimal draw.
- Avoid claiming that a draw is globally optimal unless the algorithm can establish that result.
- Document any heuristic, approximation, tie-breaking rule, or trade-off.
- Avoid hidden or arbitrary preferences that systematically advantage particular teams.
- Ensure that randomization does not override eligibility, conflict, or other hard constraints.

When optimizing draws, consider relevant constraints such as repeat matchups, team rankings, side balance, adjudicator conflicts, room availability, and tournament-specific rules. Only apply constraints that are supported by the actual tournament format and requirements.

### 7.3 Standings and scoring

When implementing standings or results calculations:

- Use the tournament's configured scoring and tie-breaking rules.
- Handle ties explicitly.
- Avoid floating-point precision errors where exact arithmetic or integer scoring is appropriate.
- Do not confuse missing results with zero scores.
- Recalculate dependent standings when relevant results change.
- Ensure that sorting is stable and deterministic when tie-breaking rules require it.
- Test boundary cases, incomplete rounds, and invalid results.

Never invent a scoring convention when the applicable format is unspecified. Inspect the existing implementation or request clarification.

### 7.4 Data integrity

Tournament data must remain internally consistent.

- Validate changes before committing them to persistent storage.
- Avoid partially applying multi-step operations when the existing persistence layer supports atomic transactions or batches.
- Prevent accidental duplicate registrations and assignments.
- Preserve identifiers and references when updating records.
- Handle concurrent updates and stale data appropriately.
- Do not silently overwrite newer user changes.
- Provide clear feedback when an operation fails.

For destructive or irreversible operations, use an explicit confirmation flow where appropriate.

## 8. Firebase and Security

Firebase is part of the existing stack. Preserve its security boundaries.

- Inspect `firestore.rules` before modifying Firestore reads or writes.
- Apply the principle of least privilege.
- Enforce authorization in security rules or trusted server-side code, not solely through UI visibility.
- Validate user-supplied data before persistence.
- Do not expose service-account credentials, private keys, or other secrets in client-side code.
- Never commit real environment files or credentials.
- Keep `.env.example` updated when new configuration variables are introduced, using placeholders rather than real values.
- Do not weaken Firestore rules to work around application bugs.
- Test access control for unauthorized reads and writes when relevant.
- Avoid logging authentication tokens, sensitive participant data, or private credentials.

Remember that client-side validation is not a security boundary.

If an operation requires privileged credentials, implement it using an appropriate trusted execution environment instead of exposing those credentials to the browser.

## 9. UI and UX Guidelines

Build interfaces that are functional, consistent, and suitable for tournament organizers working under time pressure.

- Follow the existing visual design and component conventions.
- Prefer clear layouts, readable typography, and consistent spacing.
- Keep tournament workflows predictable.
- Make critical information, validation errors, and operation status easy to understand.
- Provide loading, empty, success, and error states where applicable.
- Prevent accidental repeated submissions of operations that should execute once.
- Use responsive layouts for desktop, tablet, and mobile screens.
- Use semantic HTML and accessible form labels.
- Ensure keyboard navigation and visible focus states.
- Do not communicate status through color alone.
- Use icons consistently and provide accessible names when needed.
- Avoid unnecessary animations, decorative complexity, and excessive dependencies.

Do not redesign unrelated pages while implementing a focused feature.

## 10. CSV Import and Export

PapaParse is an existing dependency. Follow the current CSV implementation when adding or modifying import/export functionality.

- Validate required headers and field types.
- Handle empty cells, malformed rows, duplicate records, and unexpected columns.
- Normalize whitespace where appropriate without corrupting legitimate values.
- Support UTF-8 text and common spreadsheet-generated CSV files.
- Report row-specific validation errors where practical.
- Preview or validate imported data before destructive updates.
- Avoid partially importing records when validation fails unless partial imports are explicitly supported.
- Escape exported values correctly.
- Do not execute imported content as code or HTML.
- Treat imported CSV data as untrusted input.
- Test empty files, missing headers, quoted fields, commas inside values, and newline-containing fields.

Do not assume that CSV column names or schemas are interchangeable across tournament formats.

## 11. Testing Requirements

Add or update tests for every meaningful change to business logic.

Prioritize unit tests for:

- Draw generation and constraint validation.
- Duplicate team, room, and adjudicator detection.
- Bye handling and incomplete tournament registrations.
- Side allocation and balance.
- Standings, tie-breaking, and scoring.
- CSV parsing and validation.
- Input normalization.
- Permission-sensitive data operations.
- Error handling and boundary conditions.

For draw algorithms, test both valid and invalid scenarios, including cases where no feasible assignment exists.

For deterministic algorithms, verify that identical inputs and random seeds produce identical outputs.

For UI behavior, test the relevant user-visible state transitions when the existing test setup supports them.

Mock external services when testing pure business logic. Do not require live Firebase credentials or a production database for ordinary unit tests.

Keep tests deterministic and independent of execution order.

## 12. Performance

Tournament sizes and browser capabilities can vary. Optimize based on measured or clearly identified bottlenecks.

- Avoid unnecessary React re-renders.
- Avoid repeated expensive calculations during rendering.
- Avoid quadratic or worse algorithms when a practical alternative exists for the expected tournament size.
- Use efficient data structures for constraint checking and assignment lookup.
- Avoid unnecessary reads and writes to Firebase.
- Avoid loading large datasets when a smaller query or local computation is sufficient.
- Consider responsiveness when executing computationally expensive draw algorithms.
- Use Web Workers only when justified by actual computation requirements and compatible with the current architecture.

Do not sacrifice correctness or fairness for performance without explicitly documenting the trade-off.

## 13. Error Handling and Observability

Errors should be actionable and understandable.

- Validate inputs at system boundaries.
- Return or display meaningful error messages.
- Distinguish validation failures, constraint violations, permission failures, and unexpected system errors.
- Preserve useful diagnostic context without exposing sensitive data.
- Avoid empty catch blocks.
- Avoid silently substituting defaults that change tournament outcomes.
- Keep logs concise and free of credentials or unnecessary participant information.

For draw-generation failures, explain which constraints could not be satisfied when the algorithm can identify them reliably.

## 14. Dependencies and Configuration

Before adding a dependency:

1. Check whether the required functionality already exists in the project.
2. Consider whether a small local implementation would be simpler.
3. Evaluate bundle size, maintenance, compatibility, security, and licensing.
4. Confirm compatibility with the existing Next.js, React, and TypeScript versions.
5. Update the appropriate manifest and lockfile consistently.

Do not install dependencies for trivial functionality.

Avoid unnecessary changes to build configuration, environment variables, or deployment settings.

Do not upgrade major framework versions as part of an unrelated feature.

## 15. Git and Change Management

Keep changes focused and reviewable.

- Do not revert unrelated modifications.
- Do not delete files merely because they appear unused without checking references.
- Do not modify generated files unless required.
- Do not commit secrets, local databases, build outputs, or dependency directories.
- Do not rewrite Git history unless explicitly requested.
- Do not create commits, push branches, or open pull requests unless instructed.
- Preserve existing public APIs and data formats unless a breaking change is intentional and documented.

When modifying persistent data structures or schemas, consider existing tournament data and backward compatibility.

## 16. Documentation

Update documentation when a change affects:

- Developer setup.
- Environment variables.
- Available commands.
- Tournament rules or draw behavior.
- Data structures or import/export formats.
- Security and permissions.
- User-facing workflows.
- Deployment or operational requirements.

Document important algorithmic assumptions and known limitations.

Keep documentation consistent with the implementation. Do not claim support for a tournament format, feature, or constraint that has not been implemented.

## 17. Agent Workflow

For every task, follow this workflow:

1. **Understand:** Read the relevant files, identify the requested behavior, and locate existing implementations.
2. **Plan:** Determine the smallest safe change that satisfies the requirement.
3. **Implement:** Follow existing patterns and preserve unrelated behavior.
4. **Validate:** Add or update tests and run the appropriate checks.
5. **Review:** Inspect the final diff for regressions, security problems, accidental file changes, and unnecessary complexity.
6. **Report:** Summarize what changed, the important implementation decisions, the checks performed, and any remaining limitations.

Do not make broad architectural changes for a narrow request.

If requirements are ambiguous, inspect existing behavior first. Ask for clarification when an unresolved decision could affect tournament correctness, fairness, data loss, security, or compatibility.

## 18. Definition of Done

A task is complete when:

- The requested behavior is implemented.
- Existing functionality is preserved unless intentionally changed.
- Tournament constraints and data integrity are respected.
- Relevant tests are added or updated.
- Applicable tests and checks have been executed.
- Security and configuration implications have been considered.
- The final diff contains no unrelated changes.
- Known limitations are clearly disclosed.

A successful build alone does not establish that tournament logic is correct or fair.

## 19. Guiding Principle

**CrabbyTab must make debate tournaments easier to run without compromising fairness, correctness, privacy, or accessibility.**

When trade-offs arise, prioritize correct tournament behavior and trustworthy results over unnecessary complexity, cosmetic changes, or premature optimization.