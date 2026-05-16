# TaskFlow Deployment Guide

---

## Local Development

### Backend

**Prerequisites:** Node.js 20+, npm.

```bash
cd backend
npm install
cp .env.example .env
# Edit .env — fill in MONGODB_URI and JWT_SECRET at minimum
npm run dev
```

The backend starts an offline Serverless emulator (via `serverless-offline`) listening on `http://localhost:3000`.

Environment variables required for local dev (see `.env.example`):

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string. Use a dedicated dev cluster or a local `mongod` instance. Never use the production URI locally. |
| `JWT_SECRET` | Secret for signing/verifying user JWTs. Use a long random string (32+ chars). |
| `AGENT_JWT_SECRET` | Secret for signing/verifying agent JWTs. Must be different from `JWT_SECRET`. |
| `NODE_ENV` | Set to `development` for local dev. |
| `ALLOWED_ORIGINS` | CORS allowed origin, e.g., `http://localhost:3000`. |

**Do not commit `.env`.** The `.gitignore` already excludes it.

### iOS app (local dev)

**Prerequisites:** Xcode 15+, iOS 17 simulator or device, macOS 14+.

1. Open `ios/TaskFlow.xcodeproj` in Xcode.
2. Select a simulator target (iPhone 15, iOS 17+).
3. Run the app (`Cmd+R`).
4. In the app, go to **Settings** and set the API Base URL to `http://localhost:3000` (or your staging URL).
5. Log in with a test account. The token is stored and used for all subsequent API calls.

For device builds, the simulator URL will not work — point to a network-accessible staging environment.

---

## AWS Deployment

### Prerequisites

- AWS CLI configured with appropriate credentials (IAM user or assumed role with Lambda, API Gateway, CloudFormation, IAM, and Secrets Manager permissions).
- Serverless Framework v3: `npm install -g serverless`
- Node.js 20+

### Deploy to production

```bash
cd backend
npm install
sls deploy --stage prod
```

Serverless Framework will:
1. Compile TypeScript to JavaScript.
2. Package the Lambda bundle.
3. Create/update a CloudFormation stack (`taskflow-backend-prod`).
4. Deploy all functions defined in `serverless.yml` behind API Gateway HTTP API.

The deployed API Gateway endpoint URL is printed at the end of the deploy output. Copy this URL into your iOS build configuration as the production API base URL.

### Environment variables in production

**Do not pass secrets on the command line.** Inject them via AWS Systems Manager Parameter Store or Secrets Manager.

Recommended approach (SSM Parameter Store):

```bash
aws ssm put-parameter \
  --name "/taskflow/prod/MONGODB_URI" \
  --value "mongodb+srv://..." \
  --type SecureString \
  --key-id alias/aws/ssm

aws ssm put-parameter \
  --name "/taskflow/prod/JWT_SECRET" \
  --value "your-long-random-secret" \
  --type SecureString

aws ssm put-parameter \
  --name "/taskflow/prod/AGENT_JWT_SECRET" \
  --value "your-long-random-agent-secret" \
  --type SecureString
```

Reference these in `serverless.yml` using `${ssm:/taskflow/prod/MONGODB_URI}` syntax, or configure the Lambda function environment variables in the AWS Console after deploy.

The Lambda execution role already has `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:*:*:secret:taskflow/*` (see `serverless.yml`). Secrets Manager can also be used in place of or alongside SSM.

### Staging vs production

Keep staging and production as completely separate Serverless stacks (`--stage staging` vs `--stage prod`), with separate MongoDB Atlas clusters and separate secret values. Never share a `MONGODB_URI` or `JWT_SECRET` between environments.

---

## iOS Dev Build (Simulator / Ad-hoc)

1. Open `ios/TaskFlow.xcodeproj`.
2. Select your development team in **Signing & Capabilities**.
3. Choose a simulator or connected device.
4. Set the API Base URL in the Settings screen of the running app (or via a build scheme environment variable if you add that support).
5. Build and run (`Cmd+R`).

For an ad-hoc distribution (e.g., sharing with testers over the air):
- Archive the app in Xcode (**Product > Archive**).
- Export with **Ad Hoc** distribution.
- Share the `.ipa` and install via Apple Configurator or a distribution link.

---

## TestFlight Distribution

### Requirements

- Active Apple Developer Program membership.
- App record created in App Store Connect.

### Sensitive files — never commit

The following files must never be committed to the repository:

- `*.p12` — distribution certificate + private key
- `*.mobileprovision` — provisioning profile
- `AuthKey_*.p8` — App Store Connect API key

Store these in your CI/CD secret store only.

### CI/CD options

**Option A: Codemagic**
1. Connect the GitHub repository to Codemagic.
2. Add `MONGODB_URI` (backend) and `JWT_SECRET` as environment variables in the Codemagic Environment Variables section (mark as secret).
3. Add the `.p12` and `AuthKey_*.p8` as file environment variables.
4. Configure the Codemagic workflow to build, sign, and upload to TestFlight.

**Option B: GitHub Actions + Fastlane**
1. Add secrets to the GitHub repository: `APPLE_DEVELOPER_CERT_BASE64`, `APPLE_PROVISIONING_PROFILE_BASE64`, `APP_STORE_CONNECT_API_KEY_BASE64`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`.
2. Write a `Fastfile` with a `beta` lane that calls `build_app` and `upload_to_testflight`.
3. Trigger the workflow on push to `main` or a release tag.

**Option C: Xcode Cloud**
1. Connect the repository in Xcode's Xcode Cloud settings.
2. Configure a workflow: build on push to `main`, sign with your distribution certificate, and upload to TestFlight automatically.
3. Secrets and certificates are managed by Xcode Cloud — no local files needed.

### App Store Connect API key rotation

Rotate the `AuthKey_*.p8` key in App Store Connect if it is ever exposed. Update the secret in your CI store immediately after generating the new key.

---

## MongoDB Setup

### Atlas cluster

1. Log in to MongoDB Atlas.
2. Create a new cluster for production (M10 or larger; avoid free-tier M0 for production workloads).
3. Create a separate cluster for staging.

### Database and collections

1. Create a database named `taskflow`.
2. Collections are created automatically on first write by the application. To create them explicitly (recommended for production):

```js
use taskflow
db.createCollection("tasks")
db.createCollection("summaries")
db.createCollection("followupDrafts")
db.createCollection("approvalRequests")
db.createCollection("auditEvents")
db.createCollection("agentRuns")
db.createCollection("sourceRefs")
db.createCollection("users")
db.createCollection("sessions")
```

### Least-privilege database user

Create a dedicated Atlas database user for the application:

- **Username:** `taskflow-app` (or similar)
- **Password:** strong random string, stored in Secrets Manager
- **Role:** `readWrite` on the `taskflow` database only — no `admin`, no `clusterMonitor`
- **Authentication:** SCRAM-SHA-256

Example Atlas CLI command:
```bash
atlas dbusers create \
  --username taskflow-app \
  --password <generated-password> \
  --role readWrite@taskflow \
  --projectId <your-project-id>
```

### Audit collection permissions

The `auditEvents` collection should be append-only from the application's perspective. Consider creating a second, more restricted role that has `insert` but not `update` or `delete` on `auditEvents` only, and use that role for the Lambda function.

### IP allowlist

Add only the AWS Lambda outbound IPs (or your VPC NAT gateway IP) to the Atlas IP allowlist. Do not use `0.0.0.0/0` (open to the internet).

For VPC-based Lambda:
- Deploy Lambda inside a VPC with a NAT gateway.
- Add the NAT gateway's Elastic IP to the Atlas allowlist.

For non-VPC Lambda (current `serverless.yml` configuration):
- Use the AWS IP ranges for `us-east-1` Lambda (periodically rotated — consider a VPC NAT for stability).
- Alternatively, configure Atlas Private Endpoint (AWS PrivateLink) for a fixed, private connection.

### Indexes

Recommended indexes for performance and correctness (run once after cluster creation):

```js
use taskflow
db.tasks.createIndex({ userId: 1, orgId: 1, status: 1 })
db.tasks.createIndex({ userId: 1, orgId: 1, updatedAt: -1 })
db.summaries.createIndex({ userId: 1, orgId: 1, createdAt: -1 })
db.followupDrafts.createIndex({ userId: 1, orgId: 1, status: 1 })
db.approvalRequests.createIndex({ userId: 1, orgId: 1, status: 1 })
db.auditEvents.createIndex({ orgId: 1, createdAt: -1 })
db.auditEvents.createIndex({ entityType: 1, entityId: 1 })
```
