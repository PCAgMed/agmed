#!/usr/bin/env node
// Reproduz o cenário AGM-23/AGM-56 (7 PMs criados em 42s em 2026-05-30 15:33)
// e valida que o wrapper defensivo de hire (list-before-create + verify-after-5xx)
// colapsa N tentativas em 1 agente único.
//
// Sobe um servidor HTTP que imita a falha real do Paperclip:
//   POST /api/companies/:cid/agent-hires  ->  persiste o agente, devolve 500.
// Sem o guard, 3 tentativas sequenciais criam 3 agentes. Com o guard, criam 1.

import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const COMPANY_ID = "company-test";

function startBuggyServer() {
  const agents = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && url.pathname === `/api/companies/${COMPANY_ID}/agents`) {
      return send(200, Array.from(agents.values()));
    }

    if (req.method === "POST" && url.pathname === `/api/companies/${COMPANY_ID}/agent-hires`) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const id = `agent-${agents.size + 1}`;
      // Persiste primeiro (mesmo bug do Paperclip em 2026-05-30):
      agents.set(id, {
        id,
        name: body.name,
        role: body.role,
        createdAt: new Date().toISOString(),
      });
      // ...e SÓ DEPOIS levanta a exceção não tratada. O cliente vê 500.
      return send(500, { error: "Internal server error" });
    }

    return send(404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        agents,
      });
    });
  });
}

// === Wrapper de hire defensivo ===
// Idempotência baseada em (role, name) — os dois campos que o Paperclip
// usa para identificar um agente canônico no roster da empresa.
async function hireWithGuard({ baseUrl, companyId, name, role, payload }) {
  const listUrl = `${baseUrl}/api/companies/${companyId}/agents`;
  const hireUrl = `${baseUrl}/api/companies/${companyId}/agent-hires`;
  const matches = (a) => a.name === name && a.role === role;

  // 1) Pre-check: se já existe agente equivalente no roster, ABORTA e devolve o existente.
  //    Caminho seguro contra reentrância de skill, retry de heartbeat, segunda invocação humana.
  const before = await fetch(listUrl).then((r) => r.json());
  const existing = before.find(matches);
  if (existing) {
    return { agent: existing, created: false, reason: "already_exists" };
  }

  const baselineIds = new Set(before.map((a) => a.id));

  // 2) Tenta o POST.
  const res = await fetch(hireUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, name, role }),
  });

  if (res.ok) {
    const body = await res.json();
    return { agent: body, created: true, reason: "ok" };
  }

  // 3) ZONA CINZENTA: 5xx pode ter persistido o agente (foi o que causou os 7 PMs).
  //    NÃO retentar cegamente. Listar de novo e procurar agente novo (name+role).
  //    Se apareceu, tratar como sucesso silencioso. Senão, propagar erro.
  if (res.status >= 500) {
    await sleep(50);
    const after = await fetch(listUrl).then((r) => r.json());
    const newAgent = after.find((a) => matches(a) && !baselineIds.has(a.id));
    if (newAgent) {
      return { agent: newAgent, created: true, reason: "recovered_from_5xx" };
    }
  }

  const errBody = await res.text();
  const err = new Error(`hire failed: status=${res.status} body=${errBody}`);
  err.status = res.status;
  throw err;
}

// === Asserções minimalistas (sem dependência externa) ===
let failures = 0;
function check(label, pass, details = "") {
  const tag = pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${label}${details ? " — " + details : ""}`);
  if (!pass) failures++;
}

async function main() {
  const { server, baseUrl, agents } = await startBuggyServer();

  console.log("\n== Cenário 1: SEM guard, 3 POSTs sequenciais (reproduz o bug) ==");
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${baseUrl}/api/companies/${COMPANY_ID}/agent-hires`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ProductManager", role: "pm" }),
    });
    console.log(`  POST #${i + 1} -> HTTP ${res.status}`);
  }
  check(
    "sem guard, 3 POSTs criam 3 agentes (sintoma do AGM-23)",
    agents.size === 3,
    `criados=${agents.size}`
  );

  // Reset
  agents.clear();

  console.log("\n== Cenário 2: COM guard, 3 chamadas sequenciais ==");
  const results = [];
  for (let i = 0; i < 3; i++) {
    const r = await hireWithGuard({
      baseUrl,
      companyId: COMPANY_ID,
      name: "ProductManager",
      role: "pm",
      payload: { adapterType: "claude_local" },
    });
    results.push(r);
    console.log(`  call #${i + 1} -> reason=${r.reason} agentId=${r.agent.id}`);
  }
  check(
    "com guard, 3 chamadas criam exatamente 1 agente",
    agents.size === 1,
    `criados=${agents.size}`
  );
  check(
    "primeira chamada cria via recovered_from_5xx",
    results[0].created === true && results[0].reason === "recovered_from_5xx"
  );
  check(
    "chamadas seguintes devolvem o existente (created=false)",
    results.slice(1).every((r) => r.created === false && r.reason === "already_exists")
  );
  check(
    "todas as chamadas resolvem para o mesmo agentId",
    new Set(results.map((r) => r.agent.id)).size === 1
  );

  console.log("\n== Cenário 3: COM guard, hire de role diferente em paralelo ao roster ==");
  const r2 = await hireWithGuard({
    baseUrl,
    companyId: COMPANY_ID,
    name: "Designer",
    role: "designer",
    payload: { adapterType: "claude_local" },
  });
  check("role distinto cria novo agente", r2.created === true && agents.size === 2);

  server.close();

  console.log(`\n${failures === 0 ? "OK: idempotência provada." : "FAIL: " + failures + " checks falharam."}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("erro fatal:", err);
  process.exit(2);
});
