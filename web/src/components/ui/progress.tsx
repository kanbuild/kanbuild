import { cn } from '@/lib/utils';

/** Determinate when `value` is a number, indeterminate (animated) when null. Metallic track, glossy bar. */
export function Progress({ value, className, tone = 'default' }: { value: number | null; className?: string; tone?: 'default' | 'green' | 'red' | 'amber' }) {
  const bar =
    tone === 'green'
      ? 'from-emerald-400 to-emerald-600'
      : tone === 'red'
        ? 'from-red-400 to-red-600'
        : tone === 'amber'
          ? 'from-[hsl(var(--gold-hi))] to-[hsl(var(--gold-lo))]'
          : 'from-[hsl(var(--accent-hi))] to-[hsl(var(--accent-lo))]';
  const fill = cn('rounded-full bg-gradient-to-b shadow-[inset_0_1px_0_hsl(0_0%_100%/0.45)]', bar);
  return (
    <div className={cn('metal-inset relative h-1.5 w-full overflow-hidden rounded-full', className)} role="progressbar" aria-valuenow={value ?? undefined}>
      {value === null ? (
        <div className={cn('absolute inset-y-0 w-2/5 animate-indeterminate', fill)} />
      ) : (
        <div className={cn('h-full transition-all duration-500', fill)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}
