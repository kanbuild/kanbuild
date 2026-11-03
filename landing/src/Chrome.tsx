import type { ReactNode } from 'react';
import { Github } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { GITHUB_URL } from './config';

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

/** Top bar. `home` is the relative path back to the home page ('./' or '../'). */
export function Nav({ home }: { home: string }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <Container className="flex h-14 items-center justify-between gap-4">
        <a href={home} className="flex items-center gap-2">
          <Logo />
          <span className="text-sm font-semibold">Kanbuild</span>
        </a>
        <nav className="flex items-center gap-1">
          <a href={`${home}#features`} className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block">
            Features
          </a>
          <a href={`${home}#download`} className="hidden rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:block">
            Download
          </a>
          <Button asChild variant="outline" size="sm">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              <Github /> GitHub
            </a>
          </Button>
        </nav>
      </Container>
    </header>
  );
}

export function Footer({ home }: { home: string }) {
  return (
    <footer className="py-8">
      <Container className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo className="h-5 w-5 [&_svg]:h-3 [&_svg]:w-3" />
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
