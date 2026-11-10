# UptimeFlare

**UptimeFlare** is a self-hosted, Uptime Kuma-inspired uptime monitoring dashboard engineered to run **100% on the Cloudflare Workers & D1 Free Tier** and secured behind **Cloudflare Zero Trust (Cloudflare Access)**.

Built with the **Cloudflare Dashboard (Stratus / Dash) Design System**, UptimeFlare features an adaptive **3-Mode Theme Engine (`Auto` by local user time | `Light` | `Dark`)**, interactive 60-tick heartbeat bars, edge response-time latency charts, a read-only public status page (`/status`), and multi-channel alert notifications.

---

## Key Features

- **Uptime Kuma-Style Monitor Types (Edge Native)**:
  - **HTTP / HTTPS**: Custom HTTP method (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`), expected status code ranges (`200-299, 301`), custom request headers, request body, redirect control, and timeout.
  - **HTTP(s) Keyword**: Verify that the response body contains (or does *not* contain) a specific keyword.
  - **HTTP(s) JSON Query**: Evaluate nested JSON responses (`status.healthy`, `data.items[0].ok`) with operators (`==`, `!=`, `contains`, `>`, `>=`, `<`, `<=`).
  - **TCP Port**: Direct TCP socket connectivity & handshake latency measurement via Cloudflare Workers `cloudflare:sockets`.
  - **DNS Record**: Fast DNS resolution verification (`A`, `AAAA`, `CNAME`, `MX`, `TXT`, `NS`) via Cloudflare `1.1.1.1` DNS-over-HTTPS (DoH).
  - **Inbound Push / Heartbeat**: Unique `/api/push/<token>?status=up&msg=OK&ping=12` webhook URL for private servers behind NAT, cron jobs, or scripts.
- **Cloudflare Dashboard UI + Local-Time Theme Switcher**:
  - **Auto Mode (Default)**: Automatically switches between **Cloudflare Light Mode** (`06:00–18:59` local time) and **Cloudflare Dark Mode** (`19:00–05:59` local time).
  - **Manual Override**: One-click toggle to lock **Light** or **Dark** mode in the top navigation bar.
- **Cloudflare Zero Trust Security**:
  - In-Worker cryptographic verification of the `Cf-Access-Jwt-Assertion` RS256 signature against your Cloudflare Access JWKS endpoint (`https://<team-domain>/cdn-cgi/access/certs`) and Audience (`AUD`) tag.
  - Protects the Admin Dashboard (`/`) and Admin API while allowing public visitors to view `/status` and remote servers to push heartbeats to `/api/push/:token`.
- **Multi-Channel Alerting**:
  - Built-in support for **Discord**, **Slack**, **Telegram**, **Ntfy.sh**, **Pushover**, and **Generic Custom Webhooks (JSON POST)** with a live **Send Test Alert** button.
  - Configurable consecutive failure retries (`max_retries`) before marking a monitor `DOWN` and firing alerts, plus automatic `UP` recovery notifications with total downtime duration.
- **Cloudflare Free Tier Optimized**:
  - Uses **Cloudflare D1** (5 GB storage, 5,000,000 reads/day, 100,000 writes/day free) with batched writes and automatic daily retention pruning (default 30 days).

---

## Quick Start (Local Development)

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Apply D1 database migrations locally**:
   ```bash
   npm run db:migrate:local
   ```

3. **Run the Worker + React SPA locally**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:8787` for the Admin Dashboard or `http://localhost:8787/status` for the Public Status Page.

---

## Deploying to Cloudflare Workers (Free Tier)

### Step 1: Create Your Cloudflare D1 Database
```bash
npx wrangler d1 create uptimeflare-db
```
Copy the returned `database_id` into [`wrangler.toml`](file:///home/antigravity/Arsydian/UptimeFlare/wrangler.toml):
```toml
[[d1_databases]]
binding = "DB"
database_name = "uptimeflare-db"
database_id = "YOUR-D1-DATABASE-ID"
migrations_dir = "migrations"
```

### Step 2: Apply Database Schema to Remote D1
```bash
npm run db:migrate:remote
```

### Step 3: Configure Cloudflare Zero Trust (Cloudflare Access)
1. Open the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) and navigate to **Access -> Applications -> Add an application -> Self-hosted**.
2. Set your Application Domain (e.g. `uptime.yourdomain.com` or `<your-worker>.<your-subdomain>.workers.dev`).
3. Create two Policies:
   - **Policy 1 (Admin Allow)**: Action = `Allow`, Include = Your Email / GitHub / Google Identity Provider.
   - **Policy 2 (Public Status & Push Bypass — Optional)**: If you want `/status` and `/api/push/*` reachable without login, create a separate Access Application for paths `/status*`, `/api/public/*`, and `/api/push/*` with Action = `Bypass` (Include: `Everyone`).
4. Copy your **Team Domain** (e.g. `myteam.cloudflareaccess.com`) and the application's **Audience (AUD) Tag** into `wrangler.toml`:
   ```toml
   [vars]
   CF_ACCESS_TEAM_DOMAIN = "myteam.cloudflareaccess.com"
   CF_ACCESS_AUD = "your-application-aud-tag-here"
   DEV_BYPASS_AUTH = "false"
   ```

### Step 4: Deploy
```bash
npm run deploy
```
Your Worker, Static Assets, and 1-minute Cron Trigger (`* * * * *`) are now live on the Cloudflare Edge!
