# Expo App Setup Guide

This guide walks you through setting up and running the Daily Workflow Management App mobile app using Expo.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| [Node.js](https://nodejs.org/) | 18 or later | Required for Expo and npm |
| npm or [yarn](https://yarnpkg.com/) | Any current version | Package manager |
| [Expo CLI](https://docs.expo.dev/more/expo-cli/) | Latest | `npm install -g expo` or use `npx expo` |
| [Expo Go](https://expo.dev/go) | Latest | Install on your iOS or Android phone for development |
| Supabase project | — | See `docs/SETUP_DATABASE.md` |
| Git | Any | For cloning the repo |

You do **not** need Xcode or Android Studio to run the app in Expo Go. You do need them if you want to run an iOS Simulator or Android Emulator locally.

---

## 1. Clone the Repository

```bash
git clone https://github.com/your-org/daily-workflow-app.git
cd daily-workflow-app
```

---

## 2. Install Dependencies

```bash
cd app
npm install
```

---

## 3. Set Up Environment Variables

```bash
cp app/.env.example app/.env
```

Edit `app/.env` and fill in your Supabase project values:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Find these values in your Supabase dashboard at **Settings → API**.

> **Important:** Only `EXPO_PUBLIC_*` variables are available in the Expo client bundle. Never put secrets (service role key, API keys) in these variables — they are visible to anyone who inspects your app bundle.

---

## 4. Start the Expo Dev Server

```bash
cd app
npx expo start
```

The terminal will display a QR code and a list of keyboard shortcuts.

---

## 5. Open the App

**On your phone (recommended for real device testing):**
1. Install [Expo Go](https://expo.dev/go) on your iOS or Android device.
2. Open the camera app (iOS) or the Expo Go app (Android) and scan the QR code shown in the terminal.
3. The app will load on your device.

> **Network note:** By default, Expo uses LAN mode, which requires your phone and computer to be on the same Wi-Fi network. If that is not possible, start with tunnel mode:
> ```bash
> npx expo start --tunnel
> ```
> Tunnel mode routes traffic through Expo's servers — useful for testing across networks, but slower.

**In an iOS Simulator (requires Xcode on macOS):**

Press `i` in the terminal where `npx expo start` is running.

**In an Android Emulator (requires Android Studio):**

Press `a` in the terminal where `npx expo start` is running.

---

## 6. Create a Test Account

1. The app opens on the sign-in screen.
2. Tap **Sign up** and enter any email address and a password.
3. Sign in with those credentials.
4. You should land on the task list screen.

> **Tip:** For development, disable email confirmation in your Supabase project under **Authentication → Providers → Email**. Otherwise sign-up appears to succeed but sign-in returns "Email not confirmed."

---

## 7. Verify Supabase Connectivity

If you can see the empty task list after signing in, Supabase is connected correctly.

If you see an error:
- Check that `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set correctly in `app/.env`.
- Check that the `public` schema is listed under **Settings → API → Exposed schemas** in the Supabase dashboard.
- Check the Supabase dashboard for any migration errors.
- See `docs/TROUBLESHOOTING.md` for more.

---

## 8. Load Sample Data

Run the seed script to insert example tasks and a summary, so you have something to interact with:

```bash
# From the repo root — requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env
npx ts-node scripts/seed-sample-data.ts
```

Or copy one of the JSON payloads from `agent/examples/` and paste it into the **Import** screen in the app.

---

## App Structure

```
app/
├── app/                    # Expo Router file-based routing
│   ├── (auth)/             # Sign-in and sign-up screens
│   │   ├── _layout.tsx
│   │   ├── sign-in.tsx
│   │   └── sign-up.tsx
│   ├── (tabs)/             # Main tab navigation
│   │   ├── _layout.tsx
│   │   ├── index.tsx       # Task list (home tab)
│   │   ├── summaries.tsx   # Daily summaries tab
│   │   ├── workflows.tsx   # Workflows tab
│   │   └── settings.tsx    # Settings tab
│   ├── agent-connections.tsx  # Agent connection management screen
│   └── _layout.tsx         # Root layout (auth observer, navigation)
├── lib/
│   └── supabase.ts         # Supabase client with SecureStore sessions
├── services/
│   ├── tasks.ts            # Task CRUD and status updates
│   ├── summaries.ts        # Summary fetching
│   ├── workflows.ts        # Workflow fetching
│   ├── agentConnections.ts # Agent token management
│   └── agentImport.ts      # Agent JSON payload validation and import
└── types/
    └── database.ts         # TypeScript types mirroring the database schema
```

---

## Key Technical Details

**Sessions:** The Supabase auth session (JWT + refresh token) is stored in `expo-secure-store`, which uses the iOS Keychain or Android Keystore. It is hardware-backed and excluded from device backups. Large JWT payloads are automatically chunked across multiple SecureStore keys.

**Realtime:** The app subscribes to Supabase Realtime events on the `tasks` and `summaries` tables. When the agent writes new data, the app refreshes automatically.

**Agent import:** The `agentImport.ts` service validates agent JSON payloads before inserting them. It rejects payloads containing forbidden keys (`user_id`, `token`, `password`, `secret`, etc.) and normalises smart quotes from ChatGPT web output.

---

## Production Distribution

Expo Go is for **development only**. For production:

| Distribution method | Description |
|--------------------|-------------|
| **EAS Build** | Expo's managed build service. Produces `.ipa` (iOS) and `.apk`/`.aab` (Android) files. |
| **TestFlight** | Apple's beta testing platform. Requires an Apple Developer account ($99/year). |
| **iOS App Store** | Public distribution. Requires app review. |
| **Google Play** | Public distribution. Requires a Google Play developer account. |

See [Expo EAS documentation](https://docs.expo.dev/eas/) for build and submission guides.

> **Important:** When you stop running the Expo dev server on your computer, the development version of the app (loaded via Expo Go) stops working. Production builds (EAS Build) do not depend on your local machine.

---

## Common Expo Issues

See `docs/TROUBLESHOOTING.md` for a full list. Quick reference:

| Problem | Fix |
|---------|-----|
| QR code not scanning | Use tunnel mode: `npx expo start --tunnel` |
| "Unable to resolve module" | Delete `node_modules` and run `npm install` again |
| App stuck on loading screen | Check that `.env` variables are set; restart the dev server |
| "Network request failed" | Check Supabase URL in `.env`; check that `public` schema is exposed |
| Supabase "Email not confirmed" | Disable email confirmation in Supabase dashboard |
