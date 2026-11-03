import { Bot } from 'lucide-react';
import { cn } from '../lib/utils';

/** Kanbuild mark: a chrome tile with an accent glyph. Placeholder icon until the real logo lands: swap it here only. */
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('metal-chrome flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', className)}>
      <Bot className="h-4 w-4 text-[hsl(var(--accent-hi))]" />
    </div>
  );
}
