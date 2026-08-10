import { cn } from "@/lib/utils"

interface CheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
  disabled?: boolean
  id?: string
}

export function Checkbox({ checked, onCheckedChange, className, disabled, id }: CheckboxProps) {
  return (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange(e.target.checked)}
      className={cn(
        "h-4 w-4 rounded border border-input accent-primary cursor-pointer",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    />
  )
}
