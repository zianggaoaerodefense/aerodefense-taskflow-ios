# TaskFlow Deployment Guide

---

## Local Development

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase` or `npm i -g supabase`)
- Docker (required by Supabase CLI for local Postgres + Studio)
- Node.js 20+ and npm
- [EAS CLI](https://docs.expo.dev/build/introduction/) for production builds: `npm install -g eas-cli`
- Xcode 15+ for iOS Simulator (macOS only)
- Android Studio for Android Emulator (optional)

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

### Expo app (local dev)

1. Copy the environment file:
   ```bash
   cp app/.env.example app/.env
   ```
2. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` from **Supabase → Settings → API** (use local values from `supabase start` output).
3. Install dependencies:
   ```bash
   cd app && npm install
   ```
4. Start the development server:
   ```bash
   npx expo start
   ```
5. Press `i` for iOS Simulator, `a` for Android Emulator, or scan the QR code with the Expo Go app on a physical device.

For a physical device, use your staging Supabase project URL (not `127.0.0.1` — a phone cannot reach your laptop's local server).

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
| Expo build | Points to staging URL via EXPO_PUBLIC_SUPABASE_URL | Points to prod URL via EXPO_PUBLIC_SUPABASE_URL |
| Secrets | Staging values | Production values |
| Agent tokens | Separate tokens per user | Separate tokens per user |

Use EAS environment variables (`eas env:create`) or `.env` files (not committed) to switch between staging and production URLs.

---

## EAS Build (Development and Preview Builds)

[EAS Build](https://docs.expo.dev/build/introduction/) manages cloud builds for iOS and Android.

### Set up EAS

```bash
npx eas-cli login
npx eas-cli build:configure   # creates eas.json in app/
```

### Development build (replaces Expo Go, supports native modules)

```bash
# iOS
npx eas-cli build --platform ios --profile development

# Android
npx eas-cli build --platform android --profile development
```

Install the resulting build on your device or simulator, then start the dev server:

```bash
cd app && npx expo start --dev-client
```

### Preview build (internal distribution)

```bash
npx eas-cli build --platform all --profile preview
```

This produces a shareable `.ipa` / `.apk` without App Store review.

---

## EAS Submit (TestFlight / Play Store)

### Build for production

```bash
cd app
npx eas-cli build --platform ios --profile production
npx eas-cli build --platform android --profile production
```

### Submit to TestFlight

```bash
npx eas-cli submit --platform ios
```

EAS Submit handles the App Store Connect upload. You need an active Apple Developer Program membership and an app record in App Store Connect.

### Submit to Google Play

```bash
npx eas-cli submit --platform android
```

### CI/CD with GitHub Actions

Add the following secrets to your GitHub repository:
- `EXPO_TOKEN` — from expo.dev account settings
- `EXPO_PUBLIC_SUPABASE_URL` — staging or production URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — staging or production anon key

Never commit these values. Use GitHub Actions secrets or EAS environment variables (`eas env:create`).

---

## Environment Variables Reference

### Edge Functions (set as Supabase secrets)

| Variable | Set by | Description |
|---|---|---|
| `SUPABASE_URL` | Automatic | Injected by Supabase runtime |
| `SUPABASE_ANON_KEY` | Automatic | Injected by Supabase runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Automatic | Injected by Supabase runtime |

Additional secrets for future integrations (Gmail, Slack, Jira OAuth credentials) are set with `supabase secrets set`.

### Expo App (.env file, not committed)

| Variable | Value | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Not a secret; safe to bundle |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Not a secret; restricted by RLS |

Copy `app/.env.example` to `app/.env` and fill in the values. The `.env` file is gitignored. For EAS builds, use `eas env:create` to set these as EAS environment variables instead.

**Never add the service role key to .env or any file in the app directory.**

---

## Supabase Realtime

Realtime is enabled by default in `supabase/config.toml`. No additional configuration is required for the Expo app's Realtime subscriptions to work. Ensure the Realtime service is not disabled in the Supabase dashboard for your project.

---

## Alternative Architecture (AWS Lambda + MongoDB)

The `backend/` directory contains the original AWS Lambda + MongoDB Atlas implementation. Deployment instructions for that path:

- Install Serverless Framework: `npm install -g serverless`
- Configure `MONGODB_URI`, `JWT_SECRET`, `AGENT_JWT_SECRET` in AWS Secrets Manager under `/taskflow/prod/`
- Deploy: `cd backend && sls deploy --stage prod`

This is not the active MVP path. See `docs/architecture.md` for details on when this alternative might be relevant.
