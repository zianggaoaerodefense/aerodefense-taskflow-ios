# Open-Source Release Checklist

Work through this checklist before publishing the repository publicly. Check each item only after verifying it is true.

---

## Naming and Branding

- [x] Product name is "Daily Workflow Management App" (or "TaskFlow" as the technical codebase name)
- [x] No "CTO" wording remains in any file (code, docs, comments, configs, prompts)
- [x] No proprietary business names appear in user-facing content
- [x] No internal codenames or project aliases remain in documentation

---

## Secrets and Credentials

- [x] No `.env` file is committed (only `.env.example` with placeholder values)
- [x] No Supabase service role key is committed
- [x] No Supabase anon key with a real project URL is committed
- [x] No OpenAI API key is committed (`sk-...`)
- [x] No Anthropic API key is committed (`sk-ant-...`)
- [x] No GitHub personal access token is committed (`ghp_...`)
- [x] No Slack bot token is committed (`xoxb-...`)
- [x] No Jira API token is committed
- [x] No OAuth tokens or refresh tokens are committed
- [x] No private keys (RSA, EC, etc.) are committed
- [x] No build signing artifacts are committed (`.p12`, `AuthKey_*.p8`, `.mobileprovision`)

---

## Sensitive Data

- [x] No real customer data is committed
- [x] No real user IDs or organisation IDs are committed
- [x] No real email addresses are committed (only `user@example.com` placeholders)
- [x] No real company names that should not be public are committed
- [x] No private Jira tickets, Slack messages, or emails are committed
- [x] No real screenshots containing private data are committed
- [x] No exported task data files (`taskflow-export*.json`) are committed
- [x] No internal URLs (`*.internal`, `*.corp`) are committed
- [x] Seed data contains only generic fictional examples

---

## Database and Security

- [x] RLS is enabled on all user-owned tables (verified via SQL query)
- [x] RLS policies tested: user A cannot read user B's rows
- [x] Service role key is not referenced in any app code or Expo variables
- [x] `user_id` is never taken from the client/agent request body in any Edge Function
- [x] Agent tokens are hashed before storage; raw tokens are not logged

---

## Documentation

- [x] README.md is written for a public developer audience
- [x] Quick start guide is accurate and complete
- [x] docs/ARCHITECTURE.md explains the system design
- [x] docs/SETUP_APP.md covers Expo setup from scratch
- [x] docs/SETUP_DATABASE.md covers Supabase schema and RLS setup
- [x] docs/SETUP_AGENT.md explains agent integration for any runtime
- [x] docs/WORKFLOW.md documents the end-to-end daily workflow
- [x] docs/SECURITY.md has a serious security guide
- [x] docs/ENVIRONMENT_VARIABLES.md documents all variables
- [x] docs/TROUBLESHOOTING.md covers common problems
- [x] docs/ROADMAP.md documents planned features
- [x] docs/CONTRIBUTING.md explains how to contribute

---

## Legal

- [x] LICENSE file is present and correct
- [x] License is appropriate for the intended open-source release (MIT or other)
- [x] No third-party code is included without proper attribution
- [x] No proprietary code or proprietary dependencies are included

---

## Functional Testing

- [ ] App works with a fresh Supabase project (not the original dev project)
- [ ] README quick start tested end-to-end on a clean machine
- [ ] Expo setup tested from scratch (`npm install` + `npx expo start`)
- [ ] Database migration tested against a fresh Supabase project
- [ ] Sample agent payload tested via the app's Import screen
- [ ] Agent token create/revoke flow tested
- [ ] RLS isolation tested (two test users cannot see each other's data)

---

## Tooling

- [ ] `npm audit` run in `app/` — no high/critical vulnerabilities
- [ ] `gitleaks detect --source .` run — no secrets found in git history
- [ ] `bash scripts/security-scan.sh` run — no findings
- [ ] `bash scripts/sanity-check.sh` run — all checks pass

---

## Git History

- [ ] Git history does not contain any committed secrets (check with `gitleaks` or `trufflehog`)
- [ ] Git history does not contain any real `.env` files
- [ ] If secrets were ever in git history: history has been rewritten and all affected credentials rotated

---

## Final Sign-Off

- [ ] A second person has reviewed this checklist
- [ ] The repository visibility has been changed to public
- [ ] GitHub Secret Scanning has been enabled on the repository
- [ ] A security disclosure policy has been added (e.g., `SECURITY.md` at the repo root, or via GitHub's Security Advisories feature)
