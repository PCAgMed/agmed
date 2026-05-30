// Intentional type error to demonstrate that branch protection blocks
// PRs whose CI does not go green. Do NOT merge this file.
export function demo(): number {
  return 'not a number'
}
