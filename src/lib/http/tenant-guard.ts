// AGM-24 commit C — tenant guard inicial.
//
// Esta camada **mata o request failure-closed quando não há clínica ativa**.
// Plan item 6 (auditoria + audit do gate) entra em commit D/E; aqui só o
// helper que rotas usam para extrair o tenant.
//
// Invariante #2 do plan (locked pelo CEO em [AGM-24]): gate failure-closed.
// `requireActiveClinic` lança `NoActiveClinicError`; o catch na rota devolve
// 401/403 — o caller NUNCA recebe `undefined` por acidente. Esquecer o
// `await requireActiveClinic()` = a query subsequente em `withClinicScope`
// recebe `undefined` e dá throw em tempo de validação de UUID. Defesa em
// profundidade.
import { auth } from '@/auth'

export class NoActiveClinicError extends Error {
  constructor(message = 'Nenhuma clínica ativa nesta sessão') {
    super(message)
    this.name = 'NoActiveClinicError'
  }
}

export class NotAuthenticatedError extends Error {
  constructor(message = 'Não autenticado') {
    super(message)
    this.name = 'NotAuthenticatedError'
  }
}

/**
 * Retorna o `activeClinicId` do JWT da sessão atual, ou lança.
 *
 * Lança:
 *  - `NotAuthenticatedError` se não há sessão (handler → 401).
 *  - `NoActiveClinicError` se há sessão mas sem clínica ativa (handler → 403
 *    com mensagem "Selecione uma clínica" ou similar).
 *
 * O caller tipicamente usa o retorno como `clinicId` em `withClinicScope`.
 */
export async function requireActiveClinic(): Promise<{
  userId: string
  clinicId: string
}> {
  const session = await auth()
  if (!session?.user?.id) {
    throw new NotAuthenticatedError()
  }
  if (!session.activeClinicId) {
    throw new NoActiveClinicError()
  }
  return { userId: session.user.id, clinicId: session.activeClinicId }
}
