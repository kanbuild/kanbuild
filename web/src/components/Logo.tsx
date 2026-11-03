import { Bot } from 'lucide-react';
import { cn } from '../lib/utils';

/** Kanbuild mark. Placeholder icon until the real logo lands: swap it here only. */
export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground', className)}>
      <Bot className="h-4 w-4" />
    </div>
  );
}
