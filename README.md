# UptimeFlare

**UptimeFlare** is a self-hosted, Uptime Kuma-inspired uptime monitoring dashboard engineered to run within the **Cloudflare Workers Free** and **Cloudflare D1 Free** plan limits, and secured behind **Cloudflare Zero Trust (Cloudflare Access)**.

Styled after the **Cloudflare Dashboard UI**, UptimeFlare features a **3-Mode Theme Engine (`Auto` by local user time | `Light` | `Dark`)**, interactive 60-tick heartbeat bars, edge response-time latency charts, a read-only public status page (`/status`), and multi-channel alert notifications.

---

## Features & Architecture

### 1. Uptime Kuma-Style Monitor Types (Workers Edge Native)
- **HTTP / HTTPS (`http`)**: Configurable HTTP method (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`), accepted status code ranges (`200-299, 301`), custom request headers (JSON), request body, HTTP 3xx redirect following, and per-monitor timeout.
- **HTTP(s) Keyword (`keyword`)**: Inspects the HTTP response body for a required substring (or inverts the check to alert `DOWN` if a forbidden keyword appears).
- **HTTP(s) JSON Query (`json-query`)**: Evaluates dot/bracket paths (`status.healthy`, `$.data.nodes[0].region`) against expected values using `==`, `!=`, `contains`, `>`, `>=`, `<`, or `<=`.
- **TCP Port (`tcp`)**: Measures direct TCP handshake connectivity and latency using the Cloudflare Workers [`cloudflare:sockets`](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) `connect()` API. *(Note: Cloudflare Workers do not allow raw ICMP `ping` packets; use TCP Port, HTTP(s), or Inbound Push to monitor server reachability.)*
- **DNS Record (`dns`)**: Resolves `A`, `AAAA`, `CNAME`, `MX`, `TXT`, and `NS` records via Cloudflare `1.1.1.1` DNS-over-HTTPS (`https://cloudflare-dns.com/dns-query`) and optionally asserts an expected answer substring.
- **Inbound Push / Heartbeat (`push`)**: Generates a unique token-authenticated webhook URL (`/api/push/<token>?status=up&msg=OK&ping=12`) for private servers behind NAT/firewalls or cron jobs. Marked `DOWN` automatically during the scheduled cron check if no heartbeat arrives within `interval_seconds + grace_period`.

### 2. Cloudflare Dashboard UI & Adaptive Theme Switcher
- **Auto Mode (Default)**: Dynamically switches between **Light Mode** (`06:00–18:59` local device time) and **Dark Mode** (`19:00–05:59` local device time), re-evaluating every 30 seconds.
- **Manual Override**: One-click segmented control in the top navigation bar to lock **Light** or **Dark** mode (persisted in `localStorage`).

### 3. Cloudflare Zero Trust (Cloudflare Access) Security
- **In-Worker JWT Verification**: Validates the `Cf-Access-Jwt-Assertion` request header on all admin API endpoints (`/api/dashboard`, `/api/monitors/*`, `/api/notifications/*`, `/api/settings`, `/api/backup/*`) using the Web Crypto API (`RSASSA-PKCS1-v1_5` SHA-256) against your organization's public keys at `https://<team-domain>/cdn-cgi/access/certs` and verifies the Application Audience (`aud`) and expiration (`exp`, `nbf`) claims.
- **Public & Token Routes**: Leaves `/status`, `/api/public/status`, `/api/health`, and `/api/push/:token` accessible without a Zero Trust JWT so public visitors can view the status page and remote servers can push heartbeats.

### 4. Multi-Channel Alerting
- Supports **Discord** (rich embeds), **Slack** (Block Kit), **Telegram** (`sendMessage` Bot API), **Ntfy.sh**, **Pushover**, and **Generic Custom Webhooks (JSON POST)** with optional custom secret headers.
- Includes a **Send Test Alert** button in the dashboard, consecutive failure retry thresholds (`max_retries`) before opening an incident and alerting `DOWN`, and automatic `UP` recovery alerts with total downtime duration.

---

## Cloudflare Free Plan Limits & Guardrails

UptimeFlare is architected around the official [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) and [Cloudflare D1 Limits](https://developers.cloudflare.com/d1/platform/limits/) on the Free plan:

| Resource | Cloudflare Free Plan Limit | How UptimeFlare Stays Within Quota |
| :--- | :--- | :--- |
| **Static Asset Requests** | **Free & Unlimited** | The React SPA (`dist/client`) is served via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) (`not_found_handling = "single-page-application"`). Only `/api/*` paths invoke the Worker script via `run_worker_first = ["/api/*"]`. |
| **Worker Requests** | **100,000 / day** | Only `/api/*` calls and the 1-minute Cron Trigger (1,440 invocations/day) count against Worker requests. |
| **Subrequests** | **50 / invocation** | The scheduled cron runner caps checks at **35 due monitors per invocation** (ordered by oldest `last_checked_at`), leaving headroom for D1 queries and alert webhooks. |
| **Worker CPU Time** | **10 ms / invocation** | Network I/O wait time (waiting for HTTP/TCP/DNS responses) does not count toward CPU time. |
| **D1 Rows Written** | **100,000 / day** | Uses `db.batch()` to write heartbeats and update monitor state. Example: 20 monitors checked every 1 minute = ~28,800 writes/day (~29% of the free daily limit). |
| **D1 Rows Read** | **5,000,000 / day** | Indexed queries (`idx_heartbeats_monitor_time`) and window functions keep dashboard reads compact. |
| **D1 Storage** | **5 GB total** | Automatic retention cleanup runs every 6 hours during cron execution to prune heartbeats older than `retention_days` (default `30` days). |

---

## Local Development

### Prerequisites
- **Node.js** `>= 20` (Node.js 22+ recommended)
- **npm**

### Steps
1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure local environment variables**:
   Copy [`.dev.vars.example`](file:///home/antigravity/Arsydian/UptimeFlare/.dev.vars.example) to `.dev.vars` so local development bypasses Cloudflare Access JWT requirements:
   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. **Apply D1 database migrations locally**:
   ```bash
   npm run db:migrate:local
   ```

4. **Start the local development server**:
   ```bash
   npm run dev
   ```
   - **Admin Dashboard**: `http://localhost:8787/`
   - **Public Status Page**: `http://localhost:8787/status`
   - **Health Endpoint**: `http://localhost:8787/api/health`
   - **Trigger Scheduled Cron Locally**:
     ```bash
     curl "http://localhost:8787/cdn-cgi/local/scheduled"
     ```

---

## Deploying to Cloudflare (Step-by-Step)

### Step 1: Authenticate Wrangler
```bash
npx wrangler login
```

### Step 2: Create the Cloudflare D1 Database
Run the Wrangler D1 creation command:
```bash
npx wrangler d1 create uptimeflare-db
```
Copy the `database_id` UUID from the terminal output and update [`wrangler.toml`](file:///home/antigravity/Arsydian/UptimeFlare/wrangler.toml):
```toml
[[d1_databases]]
binding = "DB"
database_name = "uptimeflare-db"
database_id = "YOUR-D1-DATABASE-UUID"
migrations_dir = "migrations"
```

### Step 3: Apply the Schema to Your Remote D1 Database
```bash
npm run db:migrate:remote
```

### Step 4: Configure Cloudflare Zero Trust (Cloudflare Access)
To protect your UptimeFlare dashboard behind **Cloudflare Access** ([official documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)):

1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), navigate to **Zero Trust > Access controls > Applications** (or open the [Cloudflare One Dashboard](https://one.dash.cloudflare.com/) and go to **Access controls > Applications**).
2. Select **Create new application** (or **Add an application**) and choose **Self-hosted**.
3. **Configure the Admin Application**:
   - **Application name**: `UptimeFlare Admin`
   - **Public hostname**: Enter your Worker's custom domain or `*.workers.dev` hostname (for example, `uptime.example.com`).
   - **Access Policy**: Create a policy with **Action** = `Allow` and **Include** = `Emails` (your admin email address) or your chosen Identity Provider group.
4. **(Optional) Allow Unauthenticated Access to Public Status Page & Push Webhooks**:
   If you want visitors to view `/status` and remote servers to call `/api/push/<token>` without logging into Cloudflare Access, create a second **Self-hosted** application scoped to those paths:
   - **Public hostnames / paths**:
     - `uptime.example.com/status*`
     - `uptime.example.com/api/public/*`
     - `uptime.example.com/api/push/*`
     - `uptime.example.com/api/health`
   - **Access Policy**: Set **Action** = `Bypass` and **Include** = `Everyone`.
5. **Copy Your Team Domain and AUD Tag**:
   - **Application Audience (AUD) Tag**: In **Access controls > Applications**, select **Edit / Configure** on your `UptimeFlare Admin` application and copy the **Application Audience (AUD) Tag**.
   - **Team Domain**: Found under **Zero Trust > Settings > Custom Pages** (formatted as `<your-team-name>.cloudflareaccess.com`).
6. Set both values in [`wrangler.toml`](file:///home/antigravity/Arsydian/UptimeFlare/wrangler.toml) under `[vars]`:
   ```toml
   [vars]
   CF_ACCESS_TEAM_DOMAIN = "<your-team-name>.cloudflareaccess.com"
   CF_ACCESS_AUD = "<your-application-aud-tag>"
   DEV_BYPASS_AUTH = "false"
   ```

### Step 5: Build & Deploy
```bash
npm run deploy
```
This runs `tsc -b && vite build` to compile the SPA into `dist/client` and executes `wrangler deploy` to upload both the Worker script, Static Assets, and the `* * * * *` Cron Trigger.

---

## Automated GitHub Actions Deployment (Optional)

The included workflow at [`.github/workflows/deploy.yml`](file:///home/antigravity/Arsydian/UptimeFlare/.github/workflows/deploy.yml) uses [`cloudflare/wrangler-action@v4`](https://github.com/cloudflare/wrangler-action) to run unit tests, build the frontend, apply remote D1 migrations, and deploy the Worker on every push to `main`.

To enable it, add two repository secrets in GitHub (**Settings > Secrets and variables > Actions**):
1. `CLOUDFLARE_API_TOKEN`: Create an API Token in the Cloudflare Dashboard (**My Profile > API Tokens > Create Token**) using the **Edit Cloudflare Workers** template and include **Account > D1 > Edit** permissions.
2. `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID (found in the Cloudflare Dashboard URL or **Compute (Workers) > Workers & Pages** overview sidebar).

---

## Project Structure

```text
├── .github/workflows/deploy.yml  # GitHub Actions CI/CD using cloudflare/wrangler-action@v4
├── migrations/
│   └── 0001_initial.sql          # Cloudflare D1 SQLite schema & default settings
├── src/
│   ├── client/                   # React 19 + Vite SPA (Cloudflare Dashboard UI)
│   │   ├── components/           # Navbar, Sidebar, FleetOverview, MonitorDetail, Modals, PublicStatusPage
│   │   ├── hooks/useTheme.ts     # Auto (Local Time 06:00-18:59 Light / 19:00-05:59 Dark) + Manual theme hook
│   │   ├── styles/index.css      # Vanilla CSS design system (Light & Dark modes)
│   │   ├── api.ts                # Typed REST client
│   │   └── App.tsx               # Main application & /status router
│   └── worker/                   # Cloudflare Worker Backend (Hono)
│       ├── auth.ts               # Cloudflare Access JWT (Cf-Access-Jwt-Assertion) RS256 verifier
│       ├── checker.ts            # HTTP, Keyword, JSON Query, TCP (cloudflare:sockets), DNS (DoH), Push
│       ├── notifier.ts           # Discord, Slack, Telegram, Ntfy, Pushover & Webhook dispatcher
│       ├── scheduler.ts          # 1-minute Cron runner, retry state machine & D1 retention pruning
│       └── index.ts              # Hono API routes + fetch & scheduled exports
├── tests/
│   └── checker.test.ts           # Vitest unit tests
├── vite.config.ts                # Vite bundler outputting to dist/client
└── wrangler.toml                 # Wrangler v4 configuration (Assets, D1, Cron, Vars)
```
