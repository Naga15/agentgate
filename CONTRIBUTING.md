# Contributing to agentgate

Thanks for your interest — `agentgate` is early and contributions of all
kinds (code, design feedback, docs, adapters) are genuinely welcome. We are
explicitly **looking for co-maintainers and design partners**; see
[GOVERNANCE.md](./GOVERNANCE.md#becoming-a-maintainer).

## Ways to help right now

- **Design feedback** on the core model (policy / audit / budget / propose).
  Open an issue — disagreement is useful at this stage.
- **Adapters** — own an MCP, Backstage, or Kubernetes adapter (see
  [ROADMAP.md](./ROADMAP.md)). These are the best on-ramp to maintainership.
- **Audit backends** — a persistent (file / DB / OTel) `AuditLog` implementation.
- **Docs and examples** — real end-to-end scenarios.

## Development

```bash
yarn install
yarn build      # tsc → dist/
yarn test       # jest
yarn lint
```

Node 20+ required. The kernel has no runtime dependencies beyond `zod`.

## Pull requests

1. Fork and create a branch.
2. Keep PRs focused; add tests for new behavior (the kernel is fully tested
   and we keep it that way).
3. **Sign off your commits** (DCO): `git commit -s`. By signing off you
   certify the [Developer Certificate of Origin](https://developercertificate.org/).
4. Make sure `yarn build && yarn test` passes.
5. Open the PR against `main` and fill in the template.

## Commit messages

Conventional, imperative, scoped where useful:
`feat(policy): support attribute-based rules`. Explain the *why* in the body.

## Code of Conduct

By participating you agree to the [CNCF Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting security issues

Please do not open public issues for security vulnerabilities. See
[SECURITY.md](./SECURITY.md).
