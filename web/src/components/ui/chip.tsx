import * as React from 'react';
import { cn } from '@/lib/utils';

/** Emergent-style rounded-full chip: suggestions, filters, tab chips. `active` raises it with the accent edge. */
export const Chip = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; dot?: string; icon?: React.ReactNode }
>(({ className, active, dot, icon, children, type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-[filter,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
      active ? 'metal-raised text-foreground shadow-glow' : 'metal-raised text-muted-foreground hover:text-foreground',
      className,
    )}
    {...props}
  >
    {dot && <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />}
    {icon}
    {children}
  </button>
));
Chip.displayName = 'Chip';
