# Domain docs

This repo uses **single-context** layout: one `CONTEXT.md` at the root, plus ADRs under `docs/adr/`.

## Consumer rules

When an agent needs domain context:

1. **Start with `CONTEXT.md`** at the repo root. It holds the ubiquitous language, core concepts, and invariants.
2. **Check `docs/adr/`** for architectural decisions. ADRs are numbered `NNN-slug.md` and follow the standard template (Context / Decision / Consequences).
3. **Don't assume**. If `CONTEXT.md` doesn't define a term or `docs/adr/` doesn't have a relevant decision, ask the user or research primary sources — don't invent domain rules.

## Maintenance

- **Update `CONTEXT.md`** when the team settles new terminology, discovers an invariant, or clarifies a concept that was ambiguous.
- **Create an ADR** (`docs/adr/NNN-slug.md`) when you make an architectural decision: a choice that's hard to reverse, affects multiple modules, or establishes a new pattern.
- **Number ADRs sequentially** — find the highest `NNN` in `docs/adr/`, add one.
- **Link between them** — `CONTEXT.md` can reference ADRs by number; ADRs can reference other ADRs and point back to `CONTEXT.md` terms.

The `/domain-modeling` skill automates much of this maintenance.
