# Security Policy

## Supported versions

All Formulang packages share a single version and are released together. Only the latest release receives security fixes — upgrade to the most recent version before reporting.

| Version        | Supported |
| -------------- | --------- |
| Latest release | Yes       |
| Older releases | No        |

## Reporting a vulnerability

Report vulnerabilities privately via GitHub Security Advisories: use **"Report a vulnerability"** on the repository, or go directly to <https://github.com/formulang/formula/security/advisories/new>.

Do **not** open public issues or pull requests for undisclosed vulnerabilities. Where possible, include the formula source, registry setup, and variable values needed to reproduce the problem.

## Security model

Evaluating untrusted formulas is a design goal of Formulang, not an afterthought. The core guarantees are:

- **Property allowlisting.** Formulas can only read variables declared in the registry, and object property access is validated at parse time against typed object definitions — undeclared properties are rejected.
- **Prototype-pollution denylist.** `__proto__`, `prototype`, `constructor`, and all `__`-prefixed property names are rejected during parsing.
- **Resource limits.** Parsing and evaluation run under configurable limits: source length, token and AST-node counts, nesting depth, wall time, per-function and total cost budgets, and list/regex sizes. Failures surface as structured errors rather than thrown exceptions.

Anything that breaks these guarantees — reading non-allowlisted data, polluting prototypes, escaping the evaluation model, or bypassing resource limits — counts as a vulnerability: please report it. The full model is described in [docs/architecture.md](docs/architecture.md).
