# Clínica Agenda

Software de Controle de Agendamentos para Clínicas Médias — a Brazilian SaaS that helps small-to-medium medical clinics (5–50 staff) schedule appointments, send WhatsApp reminders, manage doctor calendars across rooms and services, and handle basic billing with PIX, all in pt-BR and built for LGPD compliance from day one.

## Stack

- **Framework**: Next.js 15 (App Router) + TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **Database**: PostgreSQL 17 (Docker)
- **Auth**: Auth.js v5 (NextAuth) with PostgreSQL adapter
- **Observability**: Grafana + Loki + Prometheus (Docker Compose)

## Local dev quickstart

```bash
cp .env.example .env.local   # fill in AUTH_SECRET (openssl rand -base64 32)
npm install
npm run dev
```

App runs at http://localhost:3000.

## Commands

| Command             | What it does                  |
| ------------------- | ----------------------------- |
| `npm run dev`       | Start dev server (Turbopack)  |
| `npm run lint`      | ESLint + TypeScript typecheck |
| `npm run typecheck` | TypeScript only               |
| `npm run format`    | Prettier write                |
| `npm test`          | Run tests (Vitest)            |
| `npm run build`     | Production build              |
