import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Toast = { id: number; text: string; tone: 'info' | 'error' };
let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();

export function toast(text: string, tone: Toast['tone'] = 'info') {
  const t = { id: nextId++, text, tone };
  toasts = [...toasts, t];
  subs.forEach((s) => s());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    subs.forEach((s) => s());
  }, tone === 'error' ? 7000 : 3500);
}

export function toastError(err: unknown) {
  toast(err instanceof Error ? err.message : String(err), 'error');
}

export function Toaster() {
  const [, force] = useState(0);
  useEffect(() => {
    const s = () => force((n) => n + 1);
    subs.add(s);
    return () => {
      subs.delete(s);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'metal-surface pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-xl animate-in slide-in-from-bottom-2',
            t.tone === 'error' && 'border-red-300 text-red-800 dark:border-red-900/80 dark:text-red-200',
          )}
        >
          {t.tone === 'error' ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 break-words">{t.text}</span>
        </div>
      ))}
    </div>
  );
}
