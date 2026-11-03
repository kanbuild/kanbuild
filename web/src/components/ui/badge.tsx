import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/** Rounded-full metallic pills, tinted per tone, with an optional leading status dot. */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none shadow-[inset_0_1px_0_hsl(var(--metal-highlight))]',
  {
    variants: {
      variant: {
        default: 'metal-accent shadow-none',
        secondary: 'metal-raised',
        outline: 'border-border bg-transparent text-foreground',
        red: 'border-red-200 bg-gradient-to-b from-red-50 to-red-100 text-red-700 dark:border-red-900/70 dark:from-red-950/70 dark:to-red-950 dark:text-red-300',
        amber: 'border-amber-300/80 bg-gradient-to-b from-amber-50 to-amber-100 text-amber-800 dark:border-amber-700/50 dark:from-amber-900/40 dark:to-amber-950/70 dark:text-amber-200',
        green: 'border-emerald-200 bg-gradient-to-b from-emerald-50 to-emerald-100 text-emerald-700 dark:border-emerald-900/70 dark:from-emerald-950/60 dark:to-emerald-950 dark:text-emerald-300',
        blue: 'border-sky-200 bg-gradient-to-b from-sky-50 to-sky-100 text-sky-700 dark:border-cyan-800/60 dark:from-cyan-950/60 dark:to-cyan-950 dark:text-cyan-200',
        violet: 'border-violet-200 bg-gradient-to-b from-violet-50 to-violet-100 text-violet-700 dark:border-violet-900/70 dark:from-violet-950/60 dark:to-violet-950 dark:text-violet-300',
        gold: 'metal-gold shadow-none',
        gray: 'border-border bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-600 dark:from-zinc-800/80 dark:to-zinc-900 dark:text-zinc-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const DOT: Record<string, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500 dark:bg-cyan-300',
  violet: 'bg-violet-500',
  gray: 'bg-zinc-400',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Show a small leading status dot in the tone's color (Emergent's chip dot). */
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[variant ?? ''] ?? 'bg-current')} />}
      {children}
    </span>
  );
}
