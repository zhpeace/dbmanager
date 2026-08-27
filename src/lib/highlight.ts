// Lightweight, dependency-free XML syntax highlighter for read-only display.
// The input is first fully HTML-escaped, so wrapping it in <span> tags is safe
// and cannot inject markup. It is heuristic (regex based), intended only to make
// XML blobs easier to read — not a strict parser.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type ContentType = "xml" | "json" | null

// Heuristic detection so we only offer a highlight toggle when it actually
// applies. JSON must parse; XML must look like a tag/declaration.
export function detectContentType(s: string): ContentType {
  const t = s.trim()
  if (!t) return null
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t)
      return "json"
    } catch {
      // not valid JSON, fall through
    }
  }
  if (t.startsWith("<") && /<[a-zA-Z!:]/i.test(t)) return "xml"
  return null
}

export function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export function highlightXml(xml: string): string {
  let s = escapeHtml(xml)

  // Comments
  s = s.replace(
    /(&lt;!--[\s\S]*?--&gt;)/g,
    '<span class="text-slate-400 italic">$1</span>'
  )
  // CDATA sections
  s = s.replace(
    /(&lt;!\[CDATA\[[\s\S]*?\]\]&gt;)/g,
    '<span class="text-amber-600">$1</span>'
  )
  // Processing instructions / declarations: <? ... ?>
  s = s.replace(
    /(&lt;\?[\s\S]*?\?&gt;)/g,
    '<span class="text-purple-500">$1</span>'
  )
  // Tags (open / close / self-closing) with attributes
  s = s.replace(
    /(&lt;\/?)([a-zA-Z][\w:.-]*)((?:[^&]|&(?!gt;))*?)(\/?&gt;)/g,
    (_m, lt, name, attrs, gt) => {
      const attrHtml = attrs.replace(
        /([\w:.-]+)(=)(&quot;[\s\S]*?&quot;|&#39;[\s\S]*?&#39;)/g,
        '<span class="text-emerald-500">$1</span>$2<span class="text-amber-300">$3</span>'
      )
      return `<span class="text-sky-400">${lt}</span><span class="text-rose-400">${name}</span>${attrHtml}<span class="text-sky-400">${gt}</span>`
    }
  )
  // Text content between tags
  s = s.replace(
    /(&gt;)([^&<]+)(&lt;)/g,
    (_m, gt, txt, lt) => `${gt}<span class="text-foreground">${txt}</span>${lt}`
  )

  return s
}

// Read-only JSON syntax highlighter. The input is HTML-escaped first, so
// wrapping in <span> is safe.
export function highlightJson(json: string): string {
  let s = escapeHtml(json)
  s = s.replace(
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-amber-300"
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? "text-emerald-500" : "text-amber-300"
      } else if (/true|false/.test(match)) {
        cls = "text-purple-500"
      } else if (/null/.test(match)) {
        cls = "text-slate-400"
      } else {
        cls = "text-sky-400"
      }
      return `<span class="${cls}">${match}</span>`
    }
  )
  return s
}
