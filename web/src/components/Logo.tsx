import logo from '../assets/logo.png';
import { cn } from '../lib/utils';

/** Kanbuild mark (robot + Kanban columns, transparent PNG). Swap it here only. */
export function Logo({ className }: { className?: string }) {
  return <img src={logo} alt="Kanbuild" draggable={false} className={cn('h-8 w-8 shrink-0 select-none object-contain', className)} />;
}
