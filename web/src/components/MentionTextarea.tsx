import { useEffect, useRef, useState } from 'react';
import { AtSign, FileText, X } from 'lucide-react';
import { api } from '@/api';
import { cn, extractFileRefs } from '@/lib/utils';
import { Textarea } from './ui/input';

/** `@query` immediately before the caret (the @ must start the text or follow whitespace / a bracket). */
const MENTION_RE = /(?:^|[\s([])@([^\s@`'"()[\]<>]*)$/;

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  projectId: string;
  value: string;
  onChange: (value: string) => void;
  /** Show the list of referenced files under the textarea. */
  showRefs?: boolean;
};

/**
 * Textarea with `@file` autocomplete: typing `@` followed by part of a path searches the repository's
 * files; ↑/↓ choose, Enter/Tab insert `@path `, Esc closes.
 */
export function MentionTextarea({ projectId, value, onChange, showRefs = true, onKeyDown, className, disabled, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [results, setResults] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const refs = showRefs ? extractFileRefs(value) : [];

  // Debounced search for the current @query.
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .searchFiles(projectId, query, 12)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setActive(0);
        })
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setLoading(false));
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, projectId]);

  const detect = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? 0;
    if (caret !== el.selectionEnd) return setQuery(null);
    const m = MENTION_RE.exec(el.value.slice(0, caret));
    if (!m) return setQuery(null);
    setStart(caret - m[1].length - 1);
    setQuery(m[1]);
  };

  const insert = (file: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const text = `@${file} `;
    const next = value.slice(0, start) + text + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  /** "Reference a file" button: put an @ at the caret and open the search. */
  const startMention = () => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? value.length;
    const needsSpace = caret > 0 && !/\s/.test(value[caret - 1]);
    const text = `${needsSpace ? ' ' : ''}@`;
    onChange(value.slice(0, caret) + text + value.slice(caret));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret + text.length, caret + text.length);
      setStart(caret + text.length - 1);
      setQuery('');
    });
  };

  const removeRef = (file: string) => {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    onChange(value.replace(new RegExp(`(^|[\\s(\\[])@${escaped}(?=[\\s.,;:!?)\\]]|$) ?`, 'g'), '$1'));
  };

  const open = query !== null && !disabled;

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Textarea
          ref={ref}
          value={value}
          disabled={disabled}
          className={className}
          onChange={(e) => {
            onChange(e.target.value);
            detect(e.target);
          }}
          onClick={(e) => detect(e.currentTarget)}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) detect(e.currentTarget);
          }}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          onKeyDown={(e) => {
            if (open && results.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                return setActive((a) => (a + 1) % results.length);
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                return setActive((a) => (a - 1 + results.length) % results.length);
              }
              if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
                e.preventDefault();
                return insert(results[active]);
              }
            }
            if (open && e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation(); // keep the dialog open
              return setQuery(null);
            }
            onKeyDown?.(e);
          }}
          {...rest}
        />
        {open && (
          <div className="metal-surface absolute left-0 right-0 top-full z-50 mt-1 origin-top animate-pop-in overflow-hidden rounded-xl bg-background shadow-xl">
            <div className="border-b px-2 py-1 text-[11px] text-muted-foreground">
              {query ? (
                <>
                  Files matching <span className="font-mono">{query}</span>
                </>
              ) : (
                'Type to search repository files'
              )}
              <span className="float-right">↑↓ · Enter · Esc</span>
            </div>
            <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
              {results.map((f, i) => {
                const slash = f.lastIndexOf('/');
                return (
                  <li
                    key={f}
                    role="option"
                    aria-selected={i === active}
                    className={cn('flex cursor-pointer items-center gap-2 px-2 py-1 text-xs', i === active ? 'bg-primary/10 text-foreground' : 'hover:bg-foreground/[0.04]')}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault(); // keep focus in the textarea
                      insert(f);
                    }}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-mono font-medium">{f.slice(slash + 1)}</span>
                    {slash > 0 && <span className="min-w-0 truncate font-mono text-muted-foreground">{f.slice(0, slash)}</span>}
                  </li>
                );
              })}
              {!results.length && <li className="px-2 py-1.5 text-xs text-muted-foreground">{loading ? 'Searching…' : 'No matching files'}</li>}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="metal-raised inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          onClick={startMention}
          disabled={disabled}
          title="Reference a repository file (or type @)"
        >
          <AtSign className="h-3 w-3" /> Reference file
        </button>
        {refs.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-sky-800 dark:text-cyan-200">
            {f}
            {!disabled && (
              <button type="button" onClick={() => removeRef(f)} aria-label={`Remove reference to ${f}`} className="hover:text-red-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
