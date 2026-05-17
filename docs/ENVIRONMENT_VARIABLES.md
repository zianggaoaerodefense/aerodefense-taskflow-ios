# Environment Variables Reference

This document describes all environment variables used in the Daily Workflow Management App. See `.env.example` for a template.

---

## Overview

Variables are divided into three groups based on where they are used:

| Group | Prefix | Safe for client? |
|-------|--------|----------------|
| Mobile app (client-side) | `EXPO_PUBLIC_` | Yes — bundled into app, visible to users |
| Server / backend | No prefix | **No — server-side only** |
| Agent | No prefix | **No — agent runtime only** |

---

## Client-Side Variables (Mobile App)

These are bundled into the Expo app at build time. They are visible to anyone who inspects the app bundle. **Never put secrets here.**

### `EXPO_PUBLIC_SUPABASE_URL`

- **Description:** Your Supabase project URL.
- **Example:** `https://your-project-ref.supabase.co`
- **Where to find it:** Supabase dashboard → Settings → API → Project URL
- **Safe to expose:** Yes. This is a public project identifier, not a secret.
- **Required:** Yes

### `EXPO_PUBLIC_SUPABASE_ANON_KEY`

- **Description:** Your Supabase anonymous (public) key.
- **Example:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- **Where to find it:** Supabase dashboard → Settings → API → Project API keys → `anon` `public`
- **Safe to expose:** Yes. Designed for client-side use. Supabase Row-Level Security restricts what it can access.
- **Required:** Yes

---

## Server-Side Variables (Edge Functions, Backend, Scripts)

These variables must **never** appear in the mobile app or be committed to the repository. Use Supabase project secrets, GitHub Actions secrets, or a secrets manager.

### `SUPABASE_URL`

- **Description:** Your Supabase project URL (same value as `EXPO_PUBLIC_SUPABASE_URL` but used server-side).
- **Example:** `https://your-project-ref.supabase.co`
- **Required for:** Backend scripts, seed scripts, Edge Function local development

### `SUPABASE_SERVICE_ROLE_KEY`

- **Description:** The Supabase service role key. Bypasses Row-Level Security. Grants full database access.
- **Example:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (a different JWT from the anon key)
- **Where to find it:** Supabase dashboard → Settings → API → Project API keys → `service_role` `secret`
- **Safe to expose:** **Never.** This is the most sensitive credential in the system.
- **Required for:** Server-side scripts, seed scripts. Automatically injected into Edge Functions — you do not need to set it manually for deployed functions.
- **Critical warning:** Must never be used in the mobile app or any client-side code.

---

## Agent Variables

These are used by the AI agent runtime. They belong in the agent's environment variables or secrets store — never in the mobile app.

### `AGENT_TOKEN`

- **Description:** The agent connection token generated in the mobile app (Settings → Connect Agent → New Connection).
- **Example:** A 64-character hex string
- **Safe to expose:** **Never.** This token grants write access to a user's Supabase data.
- **Required for:** Any agent runtime that calls the Edge Functions

---

## AI Provider Variables

Set these in your agent runtime environment. Never in the mobile app.

### `OPENAI_API_KEY`

- **Description:** OpenAI API key for agents using GPT models.
- **Example:** `sk-...`
- **Safe to expose:** **Never.**

### `ANTHROPIC_API_KEY`

- **Description:** Anthropic API key for agents using Claude models.
- **Example:** `sk-ant-...`
- **Safe to expose:** **Never.**

---

## External Integration Variables

These are for agents that integrate with external services. Server-side only. Never in the mobile app.

### `SLACK_BOT_TOKEN`

- **Description:** Slack bot token for reading channels or posting messages.
- **Example:** `xoxb-...`
- **Safe to expose:** **Never.**

### `JIRA_API_TOKEN`

- **Description:** Jira API token for reading issues or posting comments.
- **Example:** A long alphanumeric string
- **Required alongside:** `JIRA_BASE_URL`
- **Safe to expose:** **Never.**

### `JIRA_BASE_URL`

- **Description:** Your Jira instance URL.
- **Example:** `https://your-org.atlassian.net`

### `GITHUB_TOKEN`

- **Description:** GitHub personal access token or GitHub App token for reading PRs/issues.
- **Example:** `ghp_...`
- **Safe to expose:** **Never.**

### `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`

- **Description:** Google OAuth credentials for Gmail and Calendar integration.
- **Safe to expose:** `GOOGLE_CLIENT_ID` can be semi-public in some flows; `GOOGLE_CLIENT_SECRET` is never safe.

---

## Local Development

For local development with the Supabase CLI, the CLI automatically provides:

- `SUPABASE_URL` pointing to `http://127.0.0.1:54321`
- `SUPABASE_SERVICE_ROLE_KEY` for local Edge Function testing

You should not need to set these manually when using `supabase start`.

---

## Environment Files by Component

| Component | File | Contains |
|-----------|------|---------|
| Mobile app | `app/.env` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` |
| Backend scripts | `.env` (root) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Agent runtime | Agent's secrets store | `AGENT_TOKEN`, AI API keys, integration tokens |
| Edge Functions | Supabase project secrets | `SUPABASE_SERVICE_ROLE_KEY` (injected automatically) |
| CI/CD | GitHub Actions secrets | Build secrets, deploy keys |

---

## Checking for Accidental Secret Exposure

```bash
# Scan for common secret patterns
bash scripts/security-scan.sh

# Or manually
rg -n "ghp_|sk-[a-zA-Z]|xoxb-|xoxp-|AKIA|eyJ" . \
  --glob '!node_modules/**' --glob '!*.lock'
```

If a real secret is found in a committed file, rotate the secret immediately — do not just remove it from the file. The secret is in git history and must be considered compromised.
