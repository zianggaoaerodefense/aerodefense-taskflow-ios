# Open-Source Sanitization Rules

This document defines what must be removed or replaced before any content from this project is published or shared publicly. Apply these rules to skill files, agent prompts, example payloads, documentation, and any other content that may contain private information.

---

## What to Remove

### Personal names

Remove: real first names, last names, usernames, or handles belonging to individuals.

Replace with: `TEAM_MEMBER`, `USER`, `REVIEWER`, `APPROVER`, or a generic role description like "a team member".

### Company or project names

Remove: proprietary product names, internal project codenames, client names, company names, brand names, team names, and workspace names.

Replace with: `PROJECT_NAME`, `PRODUCT_NAME`, `CLIENT_NAME`, `TEAM_NAME`, or a generic description like "the product" or "your project".

### Private example content

Remove: example values drawn from real work — email subjects, Jira issue titles, Slack thread summaries, PR titles, meeting names, or document names that contain private context.

Replace with: neutral, clearly fictional examples that demonstrate the structure without revealing real information. For example:
- "Fix login timeout on mobile app" instead of a real PR title
- "Follow up with vendor on proposal" instead of a real vendor name
- "Investigate staging pipeline failure" instead of a real incident description

### Internal URLs

Remove: all non-public URLs — internal dashboards, private GitHub repos, private Notion pages, internal Confluence spaces, staging URLs, internal API endpoints with real project references.

Replace with: placeholder URLs like `https://YOUR_PROJECT_REF.supabase.co/functions/v1` or `https://your-domain.example.com`.

### IDs and tokens

Remove: all real identifiers — UUIDs from real databases, Supabase project refs, user IDs, connection IDs, Jira issue IDs, Slack channel IDs, thread IDs, PR numbers from private repos.

Replace with: clearly fake placeholders like `uuid`, `YOUR_PROJECT_REF`, `YOUR_USER_ID`, `#123`, or `issue-456`.

### Secrets and credentials

Remove: all authentication material — bearer tokens, API keys, OAuth tokens, refresh tokens, service role keys, anon keys, private keys, passwords, and any string that could be used to authenticate.

Replace with: `<agent_connection_token>`, `YOUR_SUPABASE_ANON_KEY`, `YOUR_API_KEY`, or remove entirely if the example does not need it to illustrate the concept.

### Email addresses

Remove: all real email addresses — personal emails, work emails, and any email visible in example payloads or documentation.

Replace with: `user@example.com`, `team@your-org.example.com`.

### Internal product naming

Remove: proprietary product names that are not intentionally being released as open source.

Replace with: generic names like "the workflow app", "the task management app", or "TaskFlow" (the generic name already used in this repo).

---

## What to Preserve

These elements must be kept intact when sanitizing:

- **Behaviour** — how the agent works, the execution sequence, the decision logic
- **Architecture** — the overall system design, the layer responsibilities, the data flow
- **Schemas** — field names, types, constraints, and validation rules
- **Workflows** — the supported workflow types and their steps
- **Security rules** — all security invariants must be preserved exactly
- **API contracts** — the endpoint shapes, request/response formats, and error codes
- **Skill logic** — the triage rules, extraction guidance, and quality rules

The goal is to produce content that teaches the architecture and behaviour clearly, without leaking private context.

---

## Verification Checklist

Before publishing or sharing content, confirm:

- [ ] No first or last names of real individuals
- [ ] No company, client, or project-specific names
- [ ] No internal URLs or private domain names
- [ ] No real Supabase project references
- [ ] No real bearer tokens, API keys, or secrets
- [ ] No real user IDs, connection IDs, or database UUIDs
- [ ] No real Jira IDs, Slack channel IDs, or email addresses
- [ ] All example values are clearly fictional or use recognisable placeholder patterns
- [ ] Behaviour, architecture, schemas, and security rules are intact
- [ ] A reader unfamiliar with the original private context can follow the examples

---

## Automated Scanning

The `scripts/security-scan.sh` script scans for accidental secret leaks using common patterns (high-entropy strings, known token prefixes, email address patterns). Run it before every commit that touches agent files, documentation, or skill files:

```bash
./scripts/security-scan.sh
```

This scan is not a substitute for manual review. It catches common patterns but cannot detect context-specific private information like internal project names or personal names.
