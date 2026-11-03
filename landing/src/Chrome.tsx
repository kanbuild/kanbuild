import type { ReactNode } from 'react';
import { Github, Monitor, Moon, Sun } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { setTheme, useTheme, type Theme } from '@/theme';
import { GITHUB_URL } from './config';

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

/** Page shell: the dashboard's atmospheric backdrop, floating nav and footer. */
export function Page({ home, children }: { home: string; children: ReactNode }) {
  return (
    <div className="app-backdrop flex min-h-screen flex-col overflow-x-hidden">
      <Nav home={home} />
      <main className="flex-1">{children}</main>
      <Footer home={home} />
    </div>
  );
}

/** Floating glass top bar. `home` is the relative path back to the home page ('./' or '../'). */
function Nav({ home }: { home: string }) {
  return (
    <header className="sticky top-0 z-40 px-2 pt-2 sm:px-4 sm:pt-3">
      <div className="metal-glass mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 rounded-2xl px-3 sm:px-4">
        <a href={home} className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <span className="chrome-text text-sm font-semibold tracking-tight">Kanbuild</span>
        </a>
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="pill" className="hidden sm:inline-flex">
            <a href={`${home}#features`}>Features</a>
          </Button>
          <Button asChild variant="ghost" size="pill" className="hidden sm:inline-flex">
            <a href={`${home}#download`}>Download</a>
          </Button>
          <ThemeToggle />
          <Button asChild variant="chrome" size="pill">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <Github className="!size-3.5" /> GitHub
            </a>
          </Button>
        </nav>
      </div>
    </header>
  );
}

const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: 'system', icon: Monitor, label: 'System theme' },
  { value: 'light', icon: Sun, label: 'Light theme' },
  { value: 'dark', icon: Moon, label: 'Dark theme' },
];

/** Segmented Monitor / Sun / Moon control, same storage as the dashboard's toggle. */
function ThemeToggle() {
  const theme = useTheme();
  return (
    <div className="metal-inset mx-1 flex h-7 items-center gap-0.5 rounded-full p-0.5" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground',
            theme === value && 'metal-raised text-foreground',
          )}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

function Footer({ home }: { home: string }) {
  return (
    <footer className="py-10">
      <Container className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo className="h-6 w-6" />
          <span>Kanbuild · MIT licensed · costs shown in the app are estimates</span>
        </div>
        <div className="flex items-center gap-4">
          <a href={`${home}donate/`} className="hover:text-foreground">
            Donate
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            Source on GitHub
          </a>
        </div>
      </Container>
    </footer>
  );
}
