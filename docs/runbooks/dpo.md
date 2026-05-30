# Runbook — Canal do Encarregado (DPO)

- **Endereço oficial:** `dpo@clinica-agenda.com.br`
- **Encarregado interino:** CEO (designação 2026-05-30 — [AGM-29](/AGM/issues/AGM-29))
- **Issue de provisionamento:** [AGM-44](/AGM/issues/AGM-44)
- **Base legal:** LGPD art. 41 (canal do Encarregado) + art. 19 (prazo de 15 dias)

Este runbook documenta como a caixa é provisionada, autenticada e operada. Ele
cobre dois leitores:

1. **Quem provisiona** (CEO + operação) — segue a parte "Provisionamento".
2. **Quem responde** (DPO interino + sucessores) — segue a parte "Operação".

---

## 1. Provisionamento (one-time)

### 1.1 Pré-requisito: domínio

`clinica-agenda.com.br` precisa estar registrado e sob nosso controle no
[registro.br](https://registro.br). Sem isso, nada de DNS funciona.

- [ ] Confirmar titularidade no painel do registro.br.
- [ ] Confirmar que os DNS servers apontam para a zona onde vamos publicar os
  registros (registro.br nativo, Cloudflare, Route53 — tanto faz, desde que
  saibamos onde editar).

### 1.2 Decisão de provedor

**Recomendação: Google Workspace Business Starter.**

| Critério | Google Workspace | Microsoft 365 Business Basic | Zoho Mail Lite |
|---|---|---|---|
| Custo (1 caixa) | ~R$ 27/mês | ~R$ 30/mês | ~R$ 5/mês |
| SPF/DKIM/DMARC nativos | Sim | Sim | Sim |
| Reputação de entrega | Alta | Alta | Média |
| DPA LGPD pronto | Sim | Sim | Sim |
| UX para usuário único (CEO) | Familiar (Gmail) | Outlook web | Webmail próprio |
| Encaminhamento + auto-responder | Nativos | Nativos | Nativos |

Por que Google Workspace:

- É *boring tech* — domina B2B no Brasil, o CEO provavelmente já usa Gmail.
- Reputação de entrega evita que respostas do DPO caiam em spam (risco real
  para um domínio recém-criado).
- O custo extra vs. Zoho (~R$ 22/mês) compra confiabilidade que importa num
  canal regulatório.

Se o CEO escolher outro provedor, todo o resto do runbook (DNS + auto-responder +
procedimento) continua válido — só muda quem cria a caixa.

### 1.3 Criar a caixa

Passos no console do Google Workspace (`admin.google.com`):

1. **Assinar Business Starter** vinculado ao domínio `clinica-agenda.com.br`.
   Pagamento em cartão corporativo da empresa.
2. **Verificar o domínio** — o Workspace gera um TXT (`google-site-verification=...`).
   Publicar no DNS do `clinica-agenda.com.br` no apex (`@`).
3. **Criar a conta** `dpo@clinica-agenda.com.br`. Nome de exibição:
   `Encarregado — Clínica Agenda`. Senha forte, 2FA obrigatório.
4. **Não criar alias** ainda — vamos usar encaminhamento (próxima seção) para
   chegar no e-mail pessoal do CEO sem expor a conta corporativa.

### 1.4 Encaminhamento para o CEO

Dentro da caixa `dpo@clinica-agenda.com.br` (Gmail web):

1. **Configurações → Encaminhamento e POP/IMAP → Adicionar endereço de
   encaminhamento.** Inserir o e-mail pessoal do CEO. O Google envia um código
   de verificação; o CEO clica no link recebido para autorizar.
2. **Marcar "Manter a cópia do Clínica Agenda na Caixa de Entrada"** — não
   queremos só forward; queremos histórico auditável na caixa corporativa.
3. **Não habilitar SMTP/POP/IMAP externos** salvo necessidade explícita.

### 1.5 DNS — autenticação anti-spoofing

Os três registros abaixo são obrigatórios. Publicar no DNS do
`clinica-agenda.com.br`.

#### MX (recebimento)

| Tipo | Nome | Valor | Prioridade | TTL |
|---|---|---|---|---|
| MX | `@` | `smtp.google.com.` | 1 | 3600 |

Workspace moderno usa um único MX (`smtp.google.com`). Se o registro.br exigir
formato legado, usar os 5 MX antigos (`aspmx.l.google.com`, etc.) — o Workspace
console mostra ambos.

#### SPF (autoriza Google a enviar pelo nosso domínio)

| Tipo | Nome | Valor |
|---|---|---|
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` |

`~all` (softfail) durante rollout. Subir para `-all` (hardfail) só depois de
2 semanas observando relatórios DMARC sem falsos positivos.

#### DKIM (assinatura criptográfica)

1. No console do Workspace: **Apps → Google Workspace → Gmail → Authenticate
   email**.
2. **Gerar nova chave** com tamanho `2048-bit` (não 1024).
3. Workspace gera um seletor (geralmente `google`) e um valor TXT.
4. Publicar:

| Tipo | Nome | Valor |
|---|---|---|
| TXT | `google._domainkey` | `v=DKIM1; k=rsa; p=<chave-pública-do-Workspace>` |

5. Voltar ao console e clicar **Start authentication**. Aguardar propagação
   (15-60 min).

#### DMARC (política de tratamento de falhas)

Subir em duas fases para evitar quarentenar e-mails legítimos:

**Fase 1 (semanas 1–2) — monitorar:**

| Tipo | Nome | Valor |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dpo@clinica-agenda.com.br; ruf=mailto:dpo@clinica-agenda.com.br; fo=1; adkim=s; aspf=s` |

Em `p=none` ninguém é rejeitado, mas os relatórios agregados (`rua`) chegam
todo dia no próprio `dpo@`. Ler os primeiros relatórios para garantir que
nenhum remetente legítimo está falhando.

**Fase 2 (semana 3+) — enforcement:**

Subir para `p=quarantine` por mais 2 semanas, depois `p=reject`. O valor final:

```
v=DMARC1; p=reject; rua=mailto:dpo@clinica-agenda.com.br; ruf=mailto:dpo@clinica-agenda.com.br; fo=1; adkim=s; aspf=s
```

> **Nota:** quando tivermos volume de e-mail transacional saindo do produto
> (lembretes de consulta, etc.), criar caixa dedicada `dmarc-reports@` e
> trocar `rua/ruf` para apontar para ela. Por ora, o próprio DPO recebe.

### 1.6 Auto-responder em pt-BR

Em `dpo@clinica-agenda.com.br`: **Configurações → Resposta automática**.

- **Assunto:** `Recebemos sua solicitação ao Encarregado — Clínica Agenda`
- **Corpo (texto):**

```
Olá,

Recebemos sua mensagem ao Encarregado pelo Tratamento de Dados (DPO) da
Clínica Agenda. Esta é uma confirmação automática.

Sua solicitação será analisada e respondida em até 15 dias, conforme prazo
legal estabelecido pela Lei Geral de Proteção de Dados (LGPD, art. 19).

Para acelerar:

- Se você é profissional cadastrado no nosso sistema, muitas solicitações
  (acesso, exportação, eliminação, revogação de consentimento) podem ser
  feitas diretamente em https://clinica-agenda.com.br/privacidade, com
  protocolo gerado imediatamente.

- Se você é paciente atendido em uma clínica que usa a Clínica Agenda, a
  própria clínica é a controladora dos seus dados de saúde. Recomendamos
  contatá-la primeiro. Caso prefira, podemos encaminhar sua solicitação a
  ela — basta informar o nome da clínica nesta mesma mensagem.

Não é necessário responder a esta confirmação automática. A resposta
humana virá deste mesmo endereço dentro do prazo legal.

—
Encarregado pelo Tratamento de Dados
Clínica Agenda
dpo@clinica-agenda.com.br
```

- **Resposta apenas para o primeiro e-mail por contato a cada 7 dias** (Gmail
  oferece a opção; evita loop com mailing lists e bounces).

### 1.7 Validação (smoke test obrigatório)

A caixa só é considerada provisionada quando todos estes passos passarem.

- [ ] **Entrega.** Enviar e-mail de um Gmail externo (não corporativo) para
  `dpo@clinica-agenda.com.br`. Chegar em até 60s.
- [ ] **Auto-responder.** O mesmo Gmail externo recebe a resposta automática
  em pt-BR em até 60s.
- [ ] **Encaminhamento.** A caixa pessoal do CEO recebe cópia.
- [ ] **Autenticidade saindo.** Responder a partir de `dpo@clinica-agenda.com.br`
  para um Gmail externo. Abrir o e-mail no Gmail → **Mostrar original**:
    - [ ] `SPF: PASS`
    - [ ] `DKIM: 'PASS' with domain clinica-agenda.com.br`
    - [ ] `DMARC: 'PASS'`
    - [ ] Sem warning amarelo ("via ...") na UI.
- [ ] **Outlook.** Repetir o teste anterior enviando para um endereço
  `@outlook.com` ou `@hotmail.com`. Não cair em spam, headers de autenticação
  positivos.
- [ ] **mail-tester.com.** Enviar do `dpo@` para o endereço único que o site
  fornece. Pontuação ≥ 9/10.
- [ ] **DMARC reports.** Dentro de 24-72h, chegar pelo menos um relatório
  agregado de Google/Outlook em `dpo@clinica-agenda.com.br`.

Se qualquer item falhar, **não fechar [AGM-44](/AGM/issues/AGM-44)** — o
canal não é regulatoriamente válido com headers quebrados.

---

## 2. Operação (recorrente)

### 2.1 Triagem (até 1 dia útil após recebimento)

Quando o CEO (DPO interino) recebe um e-mail encaminhado:

1. **Classificar o remetente:**
   - **Profissional cadastrado** → orientar a usar `/privacidade` (self-service
     já entrega acesso, exportação, eliminação, revogação).
   - **Paciente de uma clínica cliente** → a clínica é a controladora dos
     dados de saúde; encaminhar a ela com o paciente em cópia.
   - **Terceiro / curioso / spam** → responder negando educadamente ou
     ignorar (spam).
   - **ANPD ou autoridade** → escalar imediatamente ao jurídico (quando
     houver) e ao CTO.

2. **Identificar o direito invocado** (LGPD art. 18):

   | Inciso | Direito | Resposta esperada |
   |---|---|---|
   | I + II | Confirmação / acesso | JSON via `/api/me/data` ou export anexo |
   | III | Correção | Allowlist via `/api/me/profile` |
   | IV | Anonimização / bloqueio / eliminação por desconformidade | Avaliar caso a caso |
   | V | Portabilidade | Export JSON via `/api/me/data/export` |
   | VI | Eliminação | `/api/me/data/delete` (revoga consents, hard-delete em 30 dias) |
   | VII | Compartilhamento | Lista `/legal/subprocessadores` |
   | IX | Revogação de consentimento | `/api/me/consents/[kind]/revoke` |

3. **Gerar protocolo** — usar o mesmo formato do produto
   (`LGPD-YYYYMMDD-XXXXXXXX`). Comando direto na raiz do repo:

   ```bash
   node -e "console.log(require('./src/lib/lgpd/protocol').generateProtocol())"
   ```

### 2.2 Registrar entrada em audit_log

Antes de responder, criar a entrada de auditoria. Conexão direta no PostgreSQL
de produção (via runbook de acesso a banco, quando existir):

```sql
INSERT INTO audit_log (
  actor_type, actor_id,
  subject_type, subject_id,
  action, outcome,
  reason, protocol,
  ip, user_agent, request_id, metadata
) VALUES (
  'dpo', '<email-do-DPO>',
  '<professional|patient|third_party|unknown>', '<subject-id-ou-NULL>',
  'art18_request_received', 'received',
  '<inciso-LGPD-invocado>',
  '<LGPD-YYYYMMDD-XXXXXXXX>',
  NULL, 'email', NULL,
  jsonb_build_object('channel','email','from','<remetente>','subject','<assunto>')
);
```

O `protocol` é a chave que costura tudo: e-mail recebido → audit_log →
resposta enviada. Citá-lo na resposta humana.

### 2.3 Responder dentro de 15 dias

Modelos de resposta:

**Para profissional cadastrado (redirecionamento self-service):**

```
Olá <nome>,

Protocolo: <LGPD-...>.

Identificamos sua solicitação como exercício do direito de <inciso/direito>
previsto no art. 18 da LGPD. Para este tipo de pedido, você pode usar a
área "Minha privacidade" dentro do sistema:

https://clinica-agenda.com.br/privacidade

O fluxo é instantâneo, gera um recibo com o JSON dos seus dados e cita o
protocolo associado. Se preferir que processemos manualmente, responda
confirmando e o faremos no mesmo prazo.

Atenciosamente,
Encarregado — Clínica Agenda
```

**Para paciente (encaminhamento à clínica controladora):**

```
Olá <nome>,

Protocolo: <LGPD-...>.

A Clínica Agenda atua como *operador* dos dados de pacientes — quem é
*controladora* dos seus dados de saúde é a clínica que te atende. Por isso,
solicitações sobre seus dados precisam, em primeiro lugar, ser endereçadas
a ela.

Estamos copiando o e-mail do contato responsável da <nome-da-clínica>
nesta resposta. Eles têm prazo de 15 dias para responder; se isso não
ocorrer, podemos atuar como facilitadores. Mantenha este protocolo para
referência.

Atenciosamente,
Encarregado — Clínica Agenda
```

**Para terceiro (negativa fundamentada):**

```
Olá,

Protocolo: <LGPD-...>.

Verificamos seu pedido e não localizamos vínculo de tratamento de dados
seu pela Clínica Agenda enquanto controlador. Caso você seja paciente de
uma clínica usuária do nosso sistema, oriente o pedido à clínica
diretamente (ela é a controladora). Se houver engano, responda com mais
detalhes.

Atenciosamente,
Encarregado — Clínica Agenda
```

### 2.4 Fechar protocolo

Após enviar a resposta humana, atualizar o `audit_log` com o desfecho final:

```sql
UPDATE audit_log
SET outcome = '<responded|forwarded_to_controller|rejected>',
    metadata = metadata || jsonb_build_object('responded_at', now())
WHERE protocol = '<LGPD-...>';
```

`audit_log` é append-only no sentido de que linhas não são deletadas, mas
`UPDATE` no mesmo protocolo é permitido para registrar o desfecho — o
helper `audit.ts` usa o mesmo padrão.

### 2.5 SLA e escalonamento

- **Prazo legal:** 15 dias contínuos a partir do recebimento (LGPD art. 19).
- **Sinalização de risco:** se um pedido chegar a D-3 do prazo sem resposta,
  o DPO escala ao CTO via comentário em [AGM-29](/AGM/issues/AGM-29).
- **ANPD / autoridade pública:** resposta em até 48h, em coordenação com
  jurídico (a contratar). Não responder sozinho a ofício oficial.

---

## 3. Quando trocar de DPO interino para DPO próprio

O CEO acumula o papel temporariamente. Indicadores para promover a função a
um terceiro dedicado (ordem aproximada de chegada):

1. > 10 pedidos/mês exercendo art. 18 chegando no canal.
2. Primeiro pedido oriundo de paciente (não profissional).
3. Primeiro ofício de autoridade (ANPD, MP, Procon).
4. Empresa atinge faturamento que justifique DPO dedicado/terceirizado
   (típico: ~R$ 1M ARR ou 50+ clínicas clientes).

Quando trocar:

- Trocar o **encaminhamento** (seção 1.4) para o e-mail pessoal do novo DPO.
- Não trocar o endereço público `dpo@clinica-agenda.com.br`.
- Atualizar [AGM-29](/AGM/issues/AGM-29) com a designação.
- Atualizar este runbook (`docs/runbooks/dpo.md`) com a data da troca.

---

## 4. Histórico

| Data | Quem | Mudança |
|---|---|---|
| 2026-05-30 | CTO (FoundingEngineer) | Versão inicial — provisionamento + operação |
