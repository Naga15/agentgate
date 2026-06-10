# Security Policy

## Reporting a vulnerability

`agentgate` sits on a sensitive path — it governs what AI agents are allowed
to do to a platform — so security reports are taken seriously.

**Please do not open a public issue for a security vulnerability.**

Instead, report privately using GitHub's
[private vulnerability reporting](https://github.com/Naga15/agentgate/security/advisories/new)
for this repository. If that is unavailable, contact the maintainers listed
in [MAINTAINERS.md](./MAINTAINERS.md).

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version(s) / commit.

We aim to acknowledge reports within a few days and to coordinate a fix and
disclosure timeline with you.

## Supported versions

While in `0.x`, only the latest released minor version receives security
fixes.

## Scope notes

Because `agentgate` is a control plane, the most relevant classes of issue
are: policy bypass (a call executing that policy should have denied or
required approval for), audit gaps (an executed call not recorded), budget
bypass, and proposal-approval confusion (executing a request that does not
match its approved proposal). Reports in these areas are especially valued.
