# TaskFlow Deployment Guide

---

## Local Development

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase` or `npm i -g supabase`)
- Docker (required by Supabase CLI for local Postgres + Studio)
- Node.js 20+ (for `packages/shared`)
- Xcode 15+, iOS 17 simulator or device, macOS 14+

### Start local Supabase stack

```bash
supabase start
```

This starts a local Postgres instance, Supabase Studio (http://localhost:54323), and the Edge Function runtime. The first run takes a few minutes to pull Docker images.

The CLI prints the local credentials when it starts:

```
API URL:       http://127.0.0.1:54321
anon key:      eyJ...
service_role:  eyJ...
DB URL:        postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio:        http://127.0.0.1:54323
```

**Never commit these local credentials.** They are ephemeral and change on each `supabase start`.

### Apply migrations

```bash
supabase db reset
```

This drops and recreates the local database, then applies all migrations in `supabase/migrations/` in order. Run this after adding a new migration file.

### Run Edge Functions locally

```bash
supabase functions serve --import-map supabase/functions/import_map.json
```

Functions are served at `http://localhost:54321/functions/v1/<function-name>`.

To test a function with the local service role key:

```bash
curl -X GET http://localhost:54321/functions/v1/agent-context \
  -H "X-Agent-Token: <your-test-token>"
```

### iOS app (local dev)

1. Open `ios/TaskFlow.xcodeproj` in Xcode.
2. Add the Supabase Swift SDK via Swift Package Manager:
   - **File → Add Package Dependencies**
   - URL: `https://github.com/supabase/supabase-swift`
   - Version: Up to Next Major (2.x)
   - Products: `Supabase`, `Realtime`
3. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to your target's `Info.plist`:
   - `SUPABASE_URL` → `http://127.0.0.1:54321` (local dev) or your project URL (staging/prod)
   - `SUPABASE_ANON_KEY` → the local anon key printed by `supabase start`
4. Select a simulator target (iPhone 15, iOS 17+) and press `Cmd+R`.

For device builds, use a staging environment URL (the local `127.0.0.1` address is not reachable from a physical device on a different network).

---

## Supabase Project Setup (Staging / Production)

### Create a project

1. Log in at [supabase.com](https://supabase.com).
2. Create a new project. Choose a region close to your users.
3. Note the **Project URL** and **anon key** from **Settings → API**.
4. Never share or commit the **service role key**.

### Link the CLI to your project

```bash
supabase link --project-ref <your-project-ref>
```

### Push migrations to the remote database

```bash
supabase db push
```

This applies all migrations in `supabase/migrations/` to the remote Postgres instance.

### Deploy Edge Functions

```bash
supabase functions deploy agent-context
supabase functions deploy agent-write
supabase functions deploy agent-update-task
supabase functions deploy create-agent-connection
supabase functions deploy revoke-agent-connection
```

Or deploy all at once:

```bash
supabase functions deploy
```

### Set Edge Function secrets

The service role key is automatically available inside Edge Functions as `SUPABASE_SERVICE_ROLE_KEY`. No manual configuration is needed for that.

For any additional secrets (future integrations, webhook keys, etc.):

```bash
supabase secrets set MY_SECRET_KEY=<value>
```

**Do not put secrets in `import_map.json`, source files, or environment files committed to the repo.**

---

## Staging vs Production

Keep staging and production as completely separate Supabase projects. Never share a project URL, anon key, or service role key between environments.

| Item | Staging | Production |
|---|---|---|
| Project | `taskflow-staging` | `taskflow-prod` |
| Migrations | Applied from same repo | Applied from same repo |
| iOS build | Points to staging URL | Points to prod URL |
| Secrets | Staging values | Production values |
| Agent tokens | Separate tokens per user | Separate tokens per user |

Use Xcode build configurations (Debug/Release) or xcconfig files to switch between staging and production URLs without changing `Info.plist` manually.

---

## iOS Dev Build (Simulator / Ad-hoc)

1. Open `ios/TaskFlow.xcodeproj`.
2. Select your development team in **Signing & Capabilities**.
3. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in your active scheme's build settings or a `.xcconfig` file.
4. Choose a simulator or connected device and press `Cmd+R`.

For an ad-hoc distribution:
- Archive the app in Xcode (**Product > Archive**).
- Export with **Ad Hoc** distribution.
- Share the `.ipa` via Apple Configurator or a distribution link.

---

## TestFlight Distribution

### Requirements

- Active Apple Developer Program membership.
- App record created in App Store Connect.

### Sensitive files — never commit

| File | Reason |
|---|---|
| `*.p12` | Distribution certificate + private key |
| `*.mobileprovision` | Provisioning profile |
| `AuthKey_*.p8` | App Store Connect API key |

Store these in your CI/CD secret store only.

### CI/CD options

**Option A: Codemagic**
1. Connect the GitHub repository to Codemagic.
2. Add `SUPABASE_URL` (staging/prod) and `SUPABASE_ANON_KEY` as environment variables (mark as secret).
3. Add the `.p12` and `AuthKey_*.p8` as file environment variables.
4. Configure the Codemagic workflow to build, sign, and upload to TestFlight.

**Option B: GitHub Actions + Fastlane**
1. Add secrets to the GitHub repository: `APPLE_DEVELOPER_CERT_BASE64`, `APPLE_PROVISIONING_PROFILE_BASE64`, `APP_STORE_CONNECT_API_KEY_BASE64`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
2. Write a `Fastfile` with a `beta` lane that calls `build_app` and `upload_to_testflight`.
3. Trigger the workflow on push to `main` or a release tag.

**Option C: Xcode Cloud**
1. Connect the repository in Xcode's Xcode Cloud settings.
2. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as environment variables in the workflow.
3. Configure: build on push to `main`, sign, upload to TestFlight automatically.

---

## Environment Variables Reference

### Edge Functions (set as Supabase secrets)

| Variable | Set by | Description |
|---|---|---|
| `SUPABASE_URL` | Automatic | Injected by Supabase runtime |
| `SUPABASE_ANON_KEY` | Automatic | Injected by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Automatic | Injected by Supabase runtime |

Additional secrets for future integrations (Gmail, Slack, Jira OAuth credentials) are set with `supabase secrets set`.

### iOS App (Info.plist via xcconfig)

| Key | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://<ref>.supabase.co` | Not a secret; safe to embed |
| `SUPABASE_ANON_KEY` | `eyJ...` | Not a secret; restricted by RLS |

**Never add the service role key to Info.plist or any file in the app bundle.**

---

## Supabase Realtime

Realtime is enabled by default in `supabase/config.toml`. No additional configuration is required for the iOS app's Realtime subscriptions to work. Ensure the Realtime service is not disabled in the Supabase dashboard for your project.

---

## Alternative Architecture (AWS Lambda + MongoDB)

The `backend/` directory contains the original AWS Lambda + MongoDB Atlas implementation. Deployment instructions for that path:

- Install Serverless Framework: `npm install -g serverless`
- Configure `MONGODB_URI`, `JWT_SECRET`, `AGENT_JWT_SECRET` in AWS Secrets Manager under `/taskflow/prod/`
- Deploy: `cd backend && sls deploy --stage prod`

This is not the active MVP path. See `docs/architecture.md` for details on when this alternative might be relevant.
