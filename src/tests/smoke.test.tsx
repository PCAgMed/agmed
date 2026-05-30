import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

describe('smoke test', () => {
  it('renders a heading', () => {
    render(<h1>Clinica Agenda</h1>)
    expect(screen.getByRole('heading', { name: /clinica agenda/i })).toBeInTheDocument()
  })
})
