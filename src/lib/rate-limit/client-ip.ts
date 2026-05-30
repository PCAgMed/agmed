// Resolve the originating client IP from a request, honouring proxy headers.
// Trusts x-forwarded-for / x-real-ip because the Next.js app sits behind
// Nginx/Vercel/etc. in every supported deployment. Falls back to "unknown"
// so the rate-limit key is still bucketable instead of throwing.
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const cf = req.headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf
  return 'unknown'
}
