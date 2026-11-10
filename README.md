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
- **In-App or Environment Variable Setup**: Configure your Zero Trust **Team Domain** and **Application Audience (AUD) Tag** directly inside UptimeFlare's **Settings** modal in your browser (stored in Cloudflare D1), or via Cloudflare Worker Variables (`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`).
- **Opt-In Public Status Page (`/status`)**: Disabled by default. Can be toggled on at any time in the **Settings** modal.

### 4. Multi-Channel Alerting (Including Direct SMTP & Email API)
- Supports **Email via Direct SMTP (`smtp`)** over `cloudflare:sockets` (STARTTLS on ports `587`/`2525` or implicit SSL/TLS on port `465` with `AUTH PLAIN` / `AUTH LOGIN`), **Transactional Email API (`email`)** (Resend and SendGrid), **Discord** (rich embeds), **Slack** (Block Kit), **Telegram** (`sendMessage` Bot API), **Ntfy.sh**, **Pushover**, and **Generic Custom Webhooks (JSON POST)** with optional custom secret headers.
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

## Option 1: Zero-Terminal Deployment (Cloudflare Dashboard + In-App Setup)

You can deploy and configure UptimeFlare **entirely from your browser** without installing Node.js, building locally, or running terminal commands.

### How Zero-Terminal Provisioning Works
- **Automatic D1 Provisioning**: [`wrangler.toml`](file:///home/antigravity/Arsydian/UptimeFlare/wrangler.toml) declares `binding = "uf_db"` and `database_name = "uf_db"` without a hardcoded `database_id`. Under [Wrangler v4 Automatic Resource Provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-resource-provisioning), `npx wrangler deploy` automatically creates and binds the `uf_db` D1 database on your Cloudflare account (or inherits an existing `uf_db` binding configured in the Cloudflare Dashboard).
- **Automatic Schema Bootstrapping**: On its first request or scheduled cron run, [`ensureSchema()`](file:///home/antigravity/Arsydian/UptimeFlare/src/worker/index.ts#L21-L126) in the Worker automatically creates all 5 SQLite tables (`monitors`, `heartbeats`, `incidents`, `notification_channels`, `settings`) and default settings in D1—no manual `wrangler d1 migrations apply` command is required.
- **Preserved Dashboard Variables**: `keep_vars = true` in [`wrangler.toml`](file:///home/antigravity/Arsydian/UptimeFlare/wrangler.toml) ensures any environment variables you set in the Cloudflare Dashboard are never overwritten on subsequent Git pushes.

### Step 1: Connect the GitHub Repository in Cloudflare Workers Builds
1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to **Compute (Workers) > Workers & Pages**.
2. Click **Create application** (or **Create**), select the **Workers** tab, and choose **Import a repository** ([Workers Builds documentation](https://developers.cloudflare.com/workers/ci-cd/builds/)).
3. Select your **`UptimeFlare`** GitHub repository and configure the build settings:
   - **Project name**: `uptimeflare`
   - **Build command**: `npm run build`
   - **Deploy command**: `npx wrangler deploy`
4. Click **Save and Deploy**.
   - Cloudflare Workers Builds will install dependencies, compile the React SPA into `dist/client`, auto-provision the `uf_db` D1 database, register the `* * * * *` 1-minute Cron Trigger, and deploy your Worker.
   - *(Note: If your Cloudflare Builds token is restricted from auto-creating D1 databases, UptimeFlare will display a 1-step guide on first load—simply go to **Workers & Pages > uptimeflare > Settings > Bindings > Add binding > D1 database**, set Variable name to `uf_db`, and select/create `uf_db`.)*

### Step 2: Secure with Cloudflare Zero Trust (Cloudflare Access)
To protect your UptimeFlare dashboard behind **Cloudflare Access** ([official documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)):

1. In the [Cloudflare Dashboard](https://dash.cloudflare.com/), go to **Zero Trust > Access controls > Applications** (or open the [Cloudflare One Dashboard](https://one.dash.cloudflare.com/) and go to **Access controls > Applications**).
2. Click **Add an application** and choose **Self-hosted**.
3. **Configure the Admin Application**:
   - **Application name**: `UptimeFlare Admin`
   - **Public hostname**: Enter your Worker's custom domain or `*.workers.dev` hostname (for example, `uptime.example.com`).
   - **Access Policy**: Create a policy with **Action** = `Allow` and **Include** = `Emails` (your admin email address) or your identity group.
4. **(Optional) Bypass Cloudflare Access for Public Status Page & Push Webhooks**:
   If you want external visitors to view `/status` and remote servers to call `/api/push/<token>` without logging into Cloudflare Access, create a second **Self-hosted** application scoped to those paths:
   - **Public hostnames / paths**:
     - `uptime.example.com/status*`
     - `uptime.example.com/api/public/*`
     - `uptime.example.com/api/push/*`
     - `uptime.example.com/api/health`
   - **Access Policy**: Set **Action** = `Bypass` and **Include** = `Everyone`.
5. **Enable In-Worker JWT Verification from the UptimeFlare UI**:
   - Copy your **Application Audience (AUD) Tag** from your `UptimeFlare Admin` application in **Access controls > Applications**.
   - Copy your **Team Domain** (`<your-team-name>.cloudflareaccess.com`) from **Zero Trust > Settings > Custom Pages**.
   - Open your live UptimeFlare dashboard, click **Settings** in the top navigation bar, paste your **Team Domain** and **Application Audience (AUD) Tag** under **Cloudflare Zero Trust (In-Worker JWT Verification)**, and click **Save Settings**.
   - *(Alternatively, you can set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in the Cloudflare Dashboard under **Workers & Pages > uptimeflare > Settings > Variables and Secrets**.)*

### Step 3: Add Monitors & Alert Channels in the Dashboard
Open your UptimeFlare URL and use the web UI to:
- Click **Add Monitor** to add HTTP(s), Keyword, JSON Query, TCP Port, DNS Record, or Inbound Push monitors (and test them live with **Test Monitor Check**).
- Click **Alert Channels** to configure Discord, Slack, Telegram, Ntfy, Pushover, or Custom Webhook alerts (and verify them with **Send Test Alert**).
- Click **Settings** to customize your status page title, announcement banner, D1 retention period, or export/import JSON configuration backups.

---

## Option 2: Automated GitHub Actions Deployment (Optional)

The included workflow at [`.github/workflows/deploy.yml`](file:///home/antigravity/Arsydian/UptimeFlare/.github/workflows/deploy.yml) uses [`cloudflare/wrangler-action@v4`](https://github.com/cloudflare/wrangler-action) to run unit tests, build the frontend, and deploy the Worker (auto-provisioning D1 and Cron triggers) on every push to `main`.

To use GitHub Actions instead of Cloudflare Workers Builds, add two repository secrets in GitHub (**Settings > Secrets and variables > Actions**):
1. `CLOUDFLARE_API_TOKEN`: Create an API Token in the Cloudflare Dashboard (**My Profile > API Tokens > Create Token**) using the **Edit Cloudflare Workers** template and include **Account > D1 > Edit** permissions.
2. `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID (found in the Cloudflare Dashboard URL or **Compute (Workers) > Workers & Pages** overview sidebar).

---

## Option 3: Local Development & CLI Deployment (Optional)

If you want to develop locally or deploy from a terminal:

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Configure local environment variables**:
   Copy [`.dev.vars.example`](file:///home/antigravity/Arsydian/UptimeFlare/.dev.vars.example) to `.dev.vars`:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
3. **Start the local development server**:
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
4. **Deploy from CLI**:
   ```bash
   npx wrangler login
   npm run deploy
   ```

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
│       └── index.ts              # Hono API routes + auto-schema bootstrap + fetch & scheduled exports
├── tests/
│   └── checker.test.ts           # Vitest unit tests
├── vite.config.ts                # Vite bundler outputting to dist/client
└── wrangler.toml                 # Wrangler v4 configuration (Assets, auto-provisioned D1, Cron, keep_vars)
```
