# AGENTS.md

This repository is designed for agent-first development.
Agents must prioritize correctness, proof, and small incremental changes.

---

## Core Working Rules

- Prefer small, reversible commits.
- Always propose a plan before large changes.
- Validate changes via tests, CLI output, or specs.
- Update documentation when behavior changes.
- Ask before introducing new dependencies.
- Project overview which is guiding light can be found in docs/overview.md.
- Decision overview which is further explanation on architecture can be found in docs/decisions.md.

---

## How to Run This Project

All common actions must be executable via a single command.

- Setup: `make setup`
- Test: `make test`
- Lint: `make lint`
- Format: `make fmt`
- Run / Dev: `make dev`
- CI check: `make ci`

If any command is missing or broken, fix it before continuing work.

---

## Change Discipline

Agents may:
- Write and modify code
- Add or update tests
- Update documentation

Agents must NOT:
- Remove tests without justification
- Change public behavior without updating docs
- Introduce dependencies silently

---

## Planning Expectations

For non-trivial work:
1. Inspect the repository
2. Propose a concrete plan (files touched, tests added)
3. Implement
4. Verify via `make ci`

If scope expands, stop and re-plan.

---

## When Stuck

If blocked or uncertain:
1. Pause implementation
2. Research the issue
3. Document findings in `docs/agent-decisions.md`
4. Resume with updated context

Chat history is not a substitute for repo documentation.
