import * as React from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Chip } from './chip';

export interface ComposerSuggestion {
  icon: React.ReactNode;
  /** Prefilled text; the chip label is this text without the trailing space/colon. */
  text: string;
}

/**
 * Emergent-style prompt composer (presentational): optional folder tabs above a metal card, the input(s) as children,
 * a footer with a hint and a round accent send arrow, and optional suggestion chips below.
 */
export function Composer({
  tabs,
  children,
  footerLeft,
  hint = '⌘/Ctrl + Enter',
  onSend,
  canSend,
  sending,
  sendLabel = 'Send',
  showFooter = true,
  suggestions,
  onSuggest,
  suggestionsLabel = 'Not sure where to start? Try these',
  size = 'md',
  className,
}: {
  tabs?: React.ReactNode;
  children: React.ReactNode;
  footerLeft?: React.ReactNode;
  hint?: React.ReactNode;
  onSend: () => void;
  canSend: boolean;
  sending?: boolean;
  sendLabel?: string;
  showFooter?: boolean;
  suggestions?: ComposerSuggestion[];
  onSuggest?: (text: string) => void;
  suggestionsLabel?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={className}>
      {tabs}
      <div className={cn('metal-surface rounded-2xl transition-shadow focus-within:shadow-glow', size === 'md' ? 'p-4' : 'p-2.5')}>
        {children}
        {showFooter && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0">{footerLeft}</div>
            <div className="flex items-center gap-2">
              {hint && <span className="hidden text-[10px] text-muted-foreground sm:inline">{hint}</span>}
              <Button type="button" size="icon-round" onClick={onSend} disabled={!canSend || sending} aria-label={sendLabel} title={sendLabel}>
                <ArrowUp />
              </Button>
            </div>
          </div>
        )}
      </div>
      {suggestions && suggestions.length > 0 && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {suggestionsLabel && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3" /> {suggestionsLabel}
            </span>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <Chip key={s.text} icon={s.icon} onClick={() => onSuggest?.(s.text)}>
                {s.text.trim().replace(/:$/, '')}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Borderless textarea classes for use inside a Composer (no metal well, no ring). */
export const composerTextareaClass = 'mt-2 min-h-0 resize-none border-0 bg-transparent bg-none px-0 shadow-none focus-visible:ring-0';
