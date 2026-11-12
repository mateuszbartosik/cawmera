import type { ButtonHTMLAttributes, Ref } from 'react'
import { cn } from '../ui/controls'

export function HeaderButton({ className, ref, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium text-(--tc-label) transition-colors outline-none hover:bg-(--tc-control) hover:text-(--tc-fg) focus-visible:ring-2 focus-visible:ring-(--tc-accent)/50 disabled:pointer-events-none disabled:opacity-35',
        className
      )}
      {...rest}
    />
  )
}
