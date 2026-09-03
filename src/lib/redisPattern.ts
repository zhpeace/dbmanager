/**
 * Normalize a Redis key search input into a SCAN MATCH pattern.
 *
 * - Plain text (no glob metacharacters) becomes a substring match: `user` -> `*user*`
 *   so users don't need to remember to add wildcards (like Navicat's "contains" mode).
 * - Inputs that already contain glob metacharacters (`* ? [`) are passed through
 *   unchanged so advanced patterns like `user:*` or `*:error` still work.
 */
export function redisKeyPattern(input: string): string {
  const s = input.trim()
  if (!s) return "*"
  return /[*?[\]]/.test(s) ? s : `*${s}*`
}
