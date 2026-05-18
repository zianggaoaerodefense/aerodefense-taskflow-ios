# Contributing

Thank you for your interest in contributing to the Daily Workflow Management App. This document explains how to contribute code, documentation, or ideas.

---

## Before You Start

- Read `docs/ARCHITECTURE.md` to understand the system design.
- Read `docs/SECURITY.md` before making any changes that touch auth, data access, or credentials.
- Check the open issues on GitHub for anything already in progress.
- For significant changes, open an issue first to discuss the approach before writing code.

---

## Development Setup

1. Fork and clone the repository.
2. Follow the setup guides: `docs/SETUP_APP.md` and `docs/SETUP_DATABASE.md`.
3. Create a feature branch: `git checkout -b feature/my-feature`.

---

## Security Rules for Contributors

These are non-negotiable:

- **Never commit `.env` files or real secrets.**
- **Never commit real user data, emails, Slack content, Jira content, or customer information.**
- **Always enable RLS** on any new user-owned table you add.
- **Never trust `user_id` from the client or agent request body.** It must always be derived from the Supabase session JWT or resolved from the agent token hash.
- **Never expose the Supabase service role key** in client code, Expo variables, or committed files.
- **Use only synthetic/fake data** in tests, examples, seed files, and screenshots.

If you are unsure whether a change is safe from a security perspective, open an issue and ask before submitting a PR.

---

## Code Style

- **TypeScript** for all Expo app code, Edge Functions, and shared packages.
- **Prefer existing patterns** in the codebase over introducing new abstractions.
- **No comments** unless the reason is non-obvious (a hidden constraint, a subtle invariant, a workaround for a specific bug).
- **No analytics** unless explicitly approved.
- Keep Edge Function auth, response, and error helpers in `supabase/functions/_shared/` to avoid duplicating security-critical logic.

---

## Database Changes

- All schema changes must be made as Supabase migrations in `supabase/migrations/`.
- Never hand-edit remote database state directly.
- New user-owned tables must include `user_id uuid not null references auth.users(id)`.
- New tables must have RLS enabled with `user_id`-scoped policies.
- Append-only tables (event logs, audit trails) must have no UPDATE or DELETE policies.
- Add indexes for `user_id`, status fields, foreign keys, and timestamp columns.
- Update `packages/shared/src/types.ts` to reflect any schema changes.

---

## Edge Function Changes

- Verify that `user_id` is always resolved from the token/JWT, never from the request body.
- Service role clients must perform explicit ownership checks before every write.
- Add `audit_logs` entries for any new agent-initiated writes.
- Add `task_events` entries for any new task mutations.
- Update `docs/SETUP_AGENT.md` if the agent API contract changes.

---

## Pull Request Checklist

Before marking your PR ready for review:

- [ ] New MVP work is in `app/`, `supabase/`, `packages/shared/`, `docs/`, `agent/`, or `scripts/`.
- [ ] All database changes are migration-based under `supabase/migrations/`.
- [ ] RLS is enabled on every new user-owned table.
- [ ] RLS policies restrict access to `auth.uid() = user_id` or a reviewed alternative.
- [ ] Edge Functions do not trust `user_id` from request input.
- [ ] Service role queries are explicitly scoped by `user_id`.
- [ ] Raw agent tokens are never stored or logged.
- [ ] Agent revocation is enforced in any new token checks.
- [ ] App code contains no service role key, OpenAI key, OAuth refresh token, or credential.
- [ ] Task interactions create `task_events` rows.
- [ ] Agent writes create `agent_messages` and `audit_logs` rows.
- [ ] No real user data, emails, Slack content, or private company information in any committed file.
- [ ] `.env.example` contains only placeholder values.
- [ ] Screenshots (if any) contain only fake/sample data.
- [ ] Documentation is updated for any API or workflow changes.

---

## Adding Agent Prompts or Skills

Contribute new workflow skill prompts in `agent/prompts/` as Markdown files. Prompts should:

- Be generic and reusable (not specific to any company or domain).
- Clearly state their security constraints (see `agent/prompts/security_rules.md`).
- Include example inputs and expected outputs.
- Not reference real company names, user IDs, email addresses, or internal systems.

---

## Adding Example Payloads

Contribute example agent payloads in `agent/examples/` as JSON files. Examples must:

- Use only fictional data (e.g., "Prepare project update", "Review pull request").
- Not include `user_id`, `token`, `password`, `secret`, or any credential field.
- Follow the payload structure documented in `docs/SETUP_AGENT.md`.

---

## Reporting Security Issues

Do **not** open a public GitHub issue for security vulnerabilities. Instead, email the maintainers directly or use GitHub's private vulnerability reporting feature (Security → Report a vulnerability).

Provide:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

---

## License

By contributing to this repository, you agree that your contributions will be licensed under the same [Business Source License 1.1](../LICENSE) as the project.
