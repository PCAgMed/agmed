# Clínica Agenda

Software de Controle de Agendamentos para Clínicas Médias — a Brazilian SaaS that helps small-to-medium medical clinics (5–50 staff) schedule appointments, send WhatsApp reminders, manage doctor calendars across rooms and services, and handle basic billing with PIX, all in pt-BR and built for LGPD compliance from day one.

## Stack

- **Framework**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL 17 (Docker)
- **Auth**: Auth.js v5 (NextAuth) with PostgreSQL adapter
- **Observability**: Grafana + Loki + Prometheus (Docker Compose)

## Staging quickstart (Docker Compose)

Prerequisites: Docker + Docker Compose installed.

```bash
# 1. Generate a secret and create your local env file
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env.local

# 2. Start everything (Postgres + app + auto-migrations)
docker compose up --build

# 3. Open http://localhost:3000 in your browser
#    Click "Cadastre-se", create an account, and you land on the dashboard.
```

Monthly hosting cost at zero traffic: **~$10–15/mês** (Hostinger VPS KVM 2). All other services run in Docker containers on the same VPS at no additional cost.

## Local dev quickstart

```bash
cp .env.example .env.local   # fill in AUTH_SECRET (openssl rand -base64 32)
npm install
npm run db:up                # start Postgres container
npm run db:migrate           # apply migrations
npm run dev                  # start Next.js dev server
```

App runs at http://localhost:3000.

## Commands

| Command               | What it does                        |
| --------------------- | ----------------------------------- |
| `npm run dev`         | Start dev server (Turbopack)        |
| `npm run build`       | Production build                    |
| `npm run lint`        | ESLint + TypeScript typecheck       |
| `npm run typecheck`   | TypeScript only                     |
| `npm run format`      | Prettier write                      |
| `npm test`            | Run tests (Vitest)                  |
| `npm run db:up`       | Start Postgres container            |
| `npm run db:down`     | Stop Postgres container             |
| `npm run db:migrate`  | Apply pending Drizzle migrations    |
| `npm run db:generate` | Generate new migration from schema  |
| `npm run db:rollback` | Roll back last migration            |
| `npm run db:studio`   | Open Drizzle Studio (DB browser)    |

## Security headers

`next.config.ts` ships a baseline of security response headers (AGM-25)
applied to every route:

| Header | Value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |
| `Content-Security-Policy-Report-Only` | `default-src 'self'; …; report-uri /api/csp-report; report-to csp-endpoint` |
| `Reporting-Endpoints` | `csp-endpoint="/api/csp-report"` |

**CSP is intentionally Report-Only.** Violations POST to `/api/csp-report`,
which rate-limits per IP (120 req/min) and emits `event=csp.violation`
warnings into the Loki pipeline. Tighten to enforce
(`Content-Security-Policy`) before the first real user-input flow lands.

Verification:

```bash
# 1. Local sanity check
curl -sI http://localhost:3000/ \
  | grep -iE 'strict-transport|content-security|x-frame|x-content|referrer|permissions|reporting'

# 2. After deploying to staging behind HTTPS
#    https://securityheaders.com/?q=https://<your-staging-host>
```

### Flexing the CSP (adding a third party)

When a new origin needs to load assets, post messages, or be embedded:

1. Pick the narrowest directive(s) the change requires — typically
   `script-src`, `connect-src`, `img-src`, `style-src`, `frame-src`.
2. Edit `buildContentSecurityPolicy()` in `next.config.ts` and append the
   exact origin (no wildcards). Example: adding Stripe payments would add
   `https://js.stripe.com` to `script-src` and `https://api.stripe.com` to
   `connect-src`.
3. Run `npm test -- security-headers` to confirm the baseline still holds.
4. Watch `event=csp.violation` in Grafana for the next 24h after deploy — if
   it stays quiet, the directive is correct.

### Switching CSP to enforce

1. Wire a per-request nonce via middleware before flipping (Next.js docs:
   https://nextjs.org/docs/app/guides/content-security-policy).
2. Replace `Content-Security-Policy-Report-Only` with
   `Content-Security-Policy` in `securityHeaders`.
3. Remove `'unsafe-inline'` from `script-src`; keep the report-uri/report-to
   directives so we still capture violations.

## Architecture decisions (ADRs)

- [ADR-0001 — Rate-limit e hardening de endpoints públicos](docs/adr/0001-rate-limit-and-input-hardening.md)
