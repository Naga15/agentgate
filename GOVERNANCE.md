# Governance

`agentgate` is an open, community-driven project. This document describes how
decisions are made and how people take on responsibility. It is intentionally
lightweight at this stage and will formalize as the community grows.

## Roles

- **Contributor** — anyone who opens an issue or PR. No prior permission
  needed.
- **Reviewer** — a contributor trusted to review PRs in a given area.
  Reviews are advisory until a maintainer approves.
- **Maintainer** — listed in [MAINTAINERS.md](./MAINTAINERS.md). Has write
  access; responsible for reviews, releases, roadmap, and upholding this
  governance and the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Decision making

Day-to-day decisions use **lazy consensus**: a proposal (PR or issue) that
sees no objection from a maintainer within a reasonable window (typically a
few working days) is accepted. Any maintainer may request changes or ask for
more discussion.

Substantial changes — new subprojects, breaking API changes, governance
changes, adding or removing a maintainer — require **explicit approval from a
majority of maintainers**. While there is a single maintainer, these are
made transparently in a public issue with a comment period so the record is
clear for incoming maintainers.

## Becoming a maintainer

We want to grow the maintainer team. Nomination criteria:

1. A sustained track record of quality contribution over time — code,
   reviews, documentation, or design leadership in a subproject.
2. Demonstrated good judgment in reviews and discussions.
3. Alignment with the project's scope and the Code of Conduct.

Process: an existing maintainer nominates the candidate in a public issue.
Approval is by lazy consensus of the current maintainers over a one-week
comment period. New maintainers are added to
[MAINTAINERS.md](./MAINTAINERS.md) by PR.

Subproject ownership (e.g. an adapter) is a natural on-ramp: own an adapter,
review its PRs, and maintainership of the wider project commonly follows.

## Subprojects

Larger areas — each adapter (MCP, Backstage, Kubernetes), the audit backend,
the approval UI — may have **subproject owners** who lead that area's design
and review. Owners are listed in the relevant directory's `OWNERS` file as
the project grows.

## Code of Conduct

All participation is governed by the
[CNCF Code of Conduct](./CODE_OF_CONDUCT.md). Maintainers are responsible for
enforcing it.

## Amending this document

Changes to governance follow the "substantial changes" path above: a public
PR with a comment period and maintainer majority approval.
