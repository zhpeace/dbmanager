import { useState } from "react"
import { ExternalLink, Check } from "lucide-react"
import { useTranslation } from "react-i18next"

export interface ParsedError {
  message: string
  helpUrl?: string
}

// Split a raw DB error string into message body + optional help URL
// (e.g. "OCI Error: ORA-00923: ... \nHelp: https://docs.oracle.com/...")
export function parseError(error: string): ParsedError {
  const helpMatch = error.match(/Help:\s*(https?:\/\/\S+)/i)
  const helpUrl = helpMatch?.[1]
  const message = error.replace(/Help:\s*https?:\/\/\S+/i, "").trim()
  return { message, helpUrl }
}

interface ErrorBlockProps {
  error: string
  className?: string
}

export function ErrorBlock({ error, className }: ErrorBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const { message, helpUrl } = parseError(error)

  return (
    <div className={className ?? "text-left"}>
      <div className="text-xs text-destructive space-y-0.5">
        {message.split("\n").map((line, i) => (
          <p key={i} className="break-all whitespace-pre-wrap">{line}</p>
        ))}
      </div>
      {helpUrl && (
        <button
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive/80 underline underline-offset-2 hover:text-destructive"
          title={helpUrl}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(helpUrl)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch {}
          }}
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t('resultpanel.error_copied')}
            </>
          ) : (
            <>
              <ExternalLink className="h-3 w-3" />
              {t('resultpanel.error_help')}
            </>
          )}
        </button>
      )}
    </div>
  )
}

// "--" placeholder for missing durations
export function fmtDuration(duration: string | undefined): string {
  return duration ? duration : "—"
}
