# Clínica Agenda

[![CI](https://github.com/PCAgMed/agmed/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/PCAgMed/agmed/actions/workflows/ci.yml)

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
