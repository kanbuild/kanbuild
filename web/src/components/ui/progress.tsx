import { cn } from '@/lib/utils';

/** Determinate when `value` is a number, indeterminate (animated) when null. */
export function Progress({ value, className, tone = 'default' }: { value: number | null; className?: string; tone?: 'default' | 'green' | 'red' }) {
  const bar = tone === 'green' ? 'bg-emerald-500' : tone === 'red' ? 'bg-red-500' : 'bg-sky-500';
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-muted', className)} role="progressbar" aria-valuenow={value ?? undefined}>
      {value === null ? (
        <div className={cn('absolute inset-y-0 w-2/5 rounded-full animate-indeterminate', bar)} />
      ) : (
        <div className={cn('h-full rounded-full transition-all duration-500', bar)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      )}
    </div>
  );
}
