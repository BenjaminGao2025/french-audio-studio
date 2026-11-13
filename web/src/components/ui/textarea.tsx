import * as React from "react"
import { cn } from "cn"

type TextareaProps = React.ComponentProps<"textarea"> & {
  /** ⌘ Enter (Ctrl Enter on Windows and Linux) runs the screen's main action; plain Enter stays a new line. */
  onCmdEnter?: () => void
}

function Textarea({ className, onCmdEnter, onKeyDown, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      aria-keyshortcuts={onCmdEnter ? "Meta+Enter Control+Enter" : undefined}
      {...props}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (!onCmdEnter || e.defaultPrevented || e.key !== "Enter" || !(e.metaKey || e.ctrlKey) || e.repeat || e.nativeEvent.isComposing) return
        e.preventDefault()
        onCmdEnter()
      }}
    />
  )
}

export { Textarea }
