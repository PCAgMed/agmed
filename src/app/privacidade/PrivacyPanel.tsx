'use client'

import { useState } from 'react'

type Receipt = {
  title: string
  protocol: string
  detail?: string
  raw?: unknown
}

async function call<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let message = `Erro ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // empty body — keep generic message
    }
    return { ok: false, status: res.status, error: message }
  }
  return { ok: true, data: (await res.json()) as T }
}

export function PrivacyPanel() {
  const [busy, setBusy] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [error, setError] = useState<string | null>(null)

  function clear() {
    setReceipt(null)
    setError(null)
  }

  async function handleAccess() {
    clear()
    setBusy('access')
    const r = await call<{ protocol: string; data: unknown }>('/api/me/data')
    setBusy(null)
    if (!r.ok) return setError(r.error)
    setReceipt({
      title: 'Confirmação e acesso (Art. 18 I, II)',
      protocol: r.data.protocol,
      detail: 'Seus dados foram carregados abaixo no formato bruto (JSON).',
      raw: r.data.data,
    })
  }

  async function handleExport() {
    clear()
    if (
      !confirm(
        'Gerar e baixar um arquivo JSON com todos os seus dados? Esta ação fica registrada na auditoria.',
      )
    ) {
      return
    }
    if (!confirm('Confirma o download da portabilidade dos seus dados?')) return
    setBusy('export')
    const res = await fetch('/api/me/data/export', { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      try {
        const body = (await res.json()) as { error?: string }
        setError(body.error ?? `Erro ${res.status}`)
      } catch {
        setError(`Erro ${res.status}`)
      }
      return
    }
    const protocol = res.headers.get('x-lgpd-protocol') ?? '—'
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clinica-agenda-export-${protocol}.json`
    a.click()
    URL.revokeObjectURL(url)
    setReceipt({
      title: 'Portabilidade (Art. 18 V)',
      protocol,
      detail: 'Download iniciado. Guarde o protocolo para qualquer follow-up.',
    })
  }

  async function handleSubprocessors() {
    clear()
    setBusy('subprocessors')
    const r = await call<{ protocol: string; subprocessors: unknown }>(
      '/api/me/data/subprocessors',
    )
    setBusy(null)
    if (!r.ok) return setError(r.error)
    setReceipt({
      title: 'Subprocessadores (Art. 18 VII)',
      protocol: r.data.protocol,
      detail: 'Lista de terceiros com quem compartilhamos dados.',
      raw: r.data.subprocessors,
    })
  }

  async function handleRevokeMarketing() {
    clear()
    setBusy('revoke')
    const r = await call<{ protocol: string; receipt: unknown }>(
      '/api/me/consents/marketing_email/revoke',
      { method: 'POST' },
    )
    setBusy(null)
    if (!r.ok) return setError(r.error)
    setReceipt({
      title: 'Revogação de consentimento (Art. 18 IX)',
      protocol: r.data.protocol,
      detail: 'Consentimento de marketing por e-mail revogado (idempotente).',
      raw: r.data.receipt,
    })
  }

  async function handleDelete() {
    clear()
    if (
      !confirm(
        'Eliminar todos os seus dados pessoais? Sua conta entra em janela de 30 dias e depois é eliminada de forma programática. Esta ação não pode ser desfeita após o prazo.',
      )
    )
      return
    const typed = prompt('Para confirmar, digite a palavra ELIMINAR (em maiúsculas):')
    if (typed !== 'ELIMINAR') {
      setError('Confirmação não recebida. Eliminação cancelada.')
      return
    }
    setBusy('delete')
    const r = await call<{ protocol: string; receipt: unknown }>('/api/me/data/delete', {
      method: 'POST',
      body: JSON.stringify({ scope: 'all', confirm: 'ELIMINAR' }),
    })
    setBusy(null)
    if (!r.ok) return setError(r.error)
    setReceipt({
      title: 'Eliminação (Art. 18 VI)',
      protocol: r.data.protocol,
      detail: 'Pedido registrado. Recibo com cronograma abaixo.',
      raw: r.data.receipt,
    })
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <ActionCard
          title="Confirmação e acesso"
          law="Art. 18 I, II"
          description="Veja todos os dados que mantemos sobre você."
          action="Ver meus dados"
          onAction={handleAccess}
          busy={busy === 'access'}
        />
        <ActionCard
          title="Portabilidade"
          law="Art. 18 V"
          description="Baixe um arquivo JSON com todos os seus dados."
          action="Baixar export"
          onAction={handleExport}
          busy={busy === 'export'}
          variant="strong"
        />
        <ActionCard
          title="Compartilhamentos"
          law="Art. 18 VII"
          description="Veja com quais terceiros compartilhamos dados."
          action="Ver subprocessadores"
          onAction={handleSubprocessors}
          busy={busy === 'subprocessors'}
        />
        <ActionCard
          title="Revogar marketing"
          law="Art. 18 IX"
          description="Cancele o consentimento para comunicações de marketing."
          action="Revogar agora"
          onAction={handleRevokeMarketing}
          busy={busy === 'revoke'}
        />
        <ActionCard
          title="Eliminação"
          law="Art. 18 VI"
          description="Solicite a eliminação dos seus dados consentidos e cancele a conta."
          action="Solicitar eliminação"
          onAction={handleDelete}
          busy={busy === 'delete'}
          variant="danger"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {receipt && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <h2 className="text-base font-semibold">{receipt.title}</h2>
          <p className="mt-1">
            Protocolo: <code className="font-mono">{receipt.protocol}</code>
          </p>
          {receipt.detail && <p className="mt-1">{receipt.detail}</p>}
          {receipt.raw !== undefined && (
            <pre className="mt-3 max-h-96 overflow-auto rounded bg-white p-3 text-xs text-gray-800">
              {JSON.stringify(receipt.raw, null, 2)}
            </pre>
          )}
        </div>
      )}

      <footer className="text-xs text-gray-500">
        Dúvidas, recusas ou recurso?{' '}
        <a className="underline" href="mailto:dpo@clinica-agenda.com.br">
          dpo@clinica-agenda.com.br
        </a>{' '}
        — nosso Encarregado (DPO) responde em até 5 dias úteis.
      </footer>
    </section>
  )
}

function ActionCard({
  title,
  law,
  description,
  action,
  onAction,
  busy,
  variant = 'default',
}: {
  title: string
  law: string
  description: string
  action: string
  onAction: () => void | Promise<void>
  busy: boolean
  variant?: 'default' | 'strong' | 'danger'
}) {
  const buttonClass =
    variant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : variant === 'strong'
        ? 'bg-gray-900 text-white hover:bg-gray-800'
        : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
  return (
    <div className="flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-4">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="text-xs uppercase tracking-wide text-gray-400">LGPD {law}</p>
      </div>
      <p className="flex-1 text-sm text-gray-600">{description}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void onAction()
        }}
        className={`rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonClass}`}
      >
        {busy ? 'Processando…' : action}
      </button>
    </div>
  )
}
