import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { isLegalPagesEnabled } from '@/lib/legal/feature-flag'
import { LegalFooter } from '@/components/legal-footer'
import PrivacidadeLegalPage from '@/app/legal/privacidade/page'
import SubprocessadoresPage from '@/app/legal/subprocessadores/page'
import TermosPage from '@/app/legal/termos/page'
import {
  PRIVACY_POLICY_HISTORY,
  PRIVACY_POLICY_VERSION,
} from '@/lib/legal/version-history'
import { SUBPROCESSORS } from '@/lib/lgpd/subprocessors'

const ENV_KEY = 'LEGAL_PAGES_ENABLED'

describe('AGM-34 — feature flag', () => {
  const originalValue = process.env[ENV_KEY]

  beforeEach(() => {
    delete process.env[ENV_KEY]
  })

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY]
    } else {
      process.env[ENV_KEY] = originalValue
    }
  })

  it('está desligado por padrão', () => {
    expect(isLegalPagesEnabled()).toBe(false)
  })

  it('só liga com a string exata "true"', () => {
    process.env[ENV_KEY] = '1'
    expect(isLegalPagesEnabled()).toBe(false)
    process.env[ENV_KEY] = 'TRUE'
    expect(isLegalPagesEnabled()).toBe(false)
    process.env[ENV_KEY] = 'true'
    expect(isLegalPagesEnabled()).toBe(true)
  })
})

describe('AGM-34 — LegalFooter', () => {
  const originalValue = process.env[ENV_KEY]

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY]
    } else {
      process.env[ENV_KEY] = originalValue
    }
  })

  it('não renderiza nada com flag desligado', () => {
    delete process.env[ENV_KEY]
    const { container } = render(<LegalFooter />)
    expect(container.firstChild).toBeNull()
  })

  it('renderiza navegação para as três rotas legais com flag ligado', () => {
    process.env[ENV_KEY] = 'true'
    const { getByRole } = render(<LegalFooter />)
    const nav = getByRole('navigation', { name: /documentos legais/i })
    expect(nav.querySelector('a[href="/legal/privacidade"]')).not.toBeNull()
    expect(nav.querySelector('a[href="/legal/subprocessadores"]')).not.toBeNull()
    expect(nav.querySelector('a[href="/legal/termos"]')).not.toBeNull()
  })
})

describe('AGM-34 — Página Privacidade', () => {
  it('exibe versão atual e contém todas as seções obrigatórias da LGPD', () => {
    const { container, getByRole } = render(<PrivacidadeLegalPage />)
    expect(container.textContent).toContain(`Versão ${PRIVACY_POLICY_VERSION}`)
    // Seções obrigatórias (Art. 9 LGPD: finalidades, base legal, retenção, direitos,
    // canal do encarregado, atualizações).
    expect(getByRole('heading', { level: 2, name: /Quem somos/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Quais dados tratamos/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Por que tratamos/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Por quanto tempo/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Com quem compartilhamos/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Seus direitos/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Encarregado/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Atualizações deste aviso/i })).toBeTruthy()
    expect(getByRole('heading', { level: 2, name: /Histórico de versões/i })).toBeTruthy()
  })

  it('publica o canal do Encarregado', () => {
    const { container } = render(<PrivacidadeLegalPage />)
    const link = container.querySelector('a[href="mailto:dpo@clinica-agenda.com.br"]')
    expect(link).not.toBeNull()
  })

  it('renderiza uma entrada de histórico por versão registrada', () => {
    const { container } = render(<PrivacidadeLegalPage />)
    for (const entry of PRIVACY_POLICY_HISTORY) {
      expect(container.textContent).toContain(`Versão ${entry.version}`)
    }
  })
})

describe('AGM-34 — Página Subprocessadores', () => {
  it('lista cada subprocessador configurado em src/lib/lgpd/subprocessors.ts', () => {
    const { container } = render(<SubprocessadoresPage />)
    for (const sp of SUBPROCESSORS) {
      expect(container.textContent).toContain(sp.name)
      expect(container.textContent).toContain(sp.purpose)
      expect(container.textContent).toContain(sp.country)
    }
  })

  it('comunica o compromisso de 30 dias de antecedência', () => {
    const { container } = render(<SubprocessadoresPage />)
    expect(container.textContent).toMatch(/30 dias/)
  })
})

describe('AGM-34 — Página Termos (placeholder)', () => {
  it('renderiza aviso "Em construção" e link para a privacidade', () => {
    const { container } = render(<TermosPage />)
    expect(container.textContent).toMatch(/Em construção/i)
    expect(container.querySelector('a[href="/legal/privacidade"]')).not.toBeNull()
  })
})
