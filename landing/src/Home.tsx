import type { ReactNode } from 'react';
import {
  Apple,
  Bell,
  Bot,
  CheckCircle2,
  FileDiff,
  GitBranch,
  GitPullRequest,
  Github,
  Heart,
  Laptop,
  ShieldCheck,
  Star,
  Terminal,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Container, Footer, Nav } from './Chrome';
import { GITHUB_URL } from './config';

/** The download button leads to the donate page, which starts the download itself. */
const DOWNLOAD_HREF = './donate/?download=1';

export function Home() {
  return (
    <div className="min-h-screen">
      <Nav home="./" />
      <Hero />
      <Features />
      <Download />
      <OpenSource />
      <Footer home="./" />
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b">
      <Container className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <Badge variant="violet" className="mb-5">
            Free &amp; open source · MIT
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Drag a card. Ship a branch.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            Kanbuild is a local-first Kanban board for your git repos. Move a feature into <span className="font-medium text-foreground">Build</span> and
            Claude Code agents plan, implement, validate, test and review it in an isolated worktree, while you watch every step live.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="px-6">
              <a href={DOWNLOAD_HREF}>
                <Apple /> Download for macOS
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="px-6">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Github /> View on GitHub
              </a>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">Apple silicon &amp; Intel · Needs git and the Claude Code CLI · Also runs in your browser</p>
        </div>
        <BoardMock />
      </Container>
    </section>
  );
}

type MockCard = { title: string; badge: ReactNode; meta?: string; progress?: number | null; tone?: 'amber' | 'sky' | 'emerald' };

const COLUMNS: { name: string; hint: string; cards: MockCard[] }[] = [
  {
    name: 'Backlog',
    hint: '2 cards',
    cards: [
      { title: 'Dark mode toggle', badge: <Badge variant="gray">backlog</Badge>, meta: 'priority: medium' },
      { title: 'CSV export for reports', badge: <Badge variant="gray">blocked</Badge>, meta: 'depends on: Reports API' },
    ],
  },
  {
    name: 'Build',
    hint: '1 running · 1 waiting',
    cards: [
      { title: 'Reports API', badge: <Badge variant="blue">running</Badge>, meta: 'Develop · #1 · 48.2k tok · est. $0.41', progress: null, tone: 'sky' },
      { title: 'OAuth login', badge: <Badge variant="amber">approve plan</Badge>, meta: 'Plan ready for review', tone: 'amber' },
    ],
  },
  {
    name: 'Done',
    hint: '1 card',
    cards: [{ title: 'Rate limiting', badge: <Badge variant="green">done</Badge>, meta: 'PR #42 opened', progress: 100, tone: 'emerald' }],
  },
];

function BoardMock() {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 shadow-sm" aria-label="Kanbuild board preview">
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="text-sm font-semibold">acme-web</div>
          <div className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
            <GitBranch className="h-3 w-3" /> main
          </div>
        </div>
        <span className="text-xs text-muted-foreground">est. ~$1.27</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.name} className="rounded-md bg-background/60 p-2">
            <div className="mb-2 px-1">
              <div className="text-xs font-semibold">{col.name}</div>
              <div className="text-[10px] text-muted-foreground">{col.hint}</div>
            </div>
            <div className="space-y-2">
              {col.cards.map((c) => (
                <div
                  key={c.title}
                  className={cn(
                    'rounded-md border bg-card p-2.5 text-card-foreground shadow-sm',
                    c.tone === 'amber' && 'ring-1 ring-amber-400/70',
                    c.meta?.startsWith('depends') && 'border-dashed',
                  )}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">{c.badge}</div>
                  <div className="text-xs font-medium leading-snug">{c.title}</div>
                  {c.meta && <div className="mt-1 text-[10px] text-muted-foreground">{c.meta}</div>}
                  {c.progress !== undefined && (
                    <div className="mt-2">
                      <Progress value={c.progress} tone={c.tone === 'emerald' ? 'green' : 'default'} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { icon: Workflow, title: 'Kanban in, agents out', body: 'Drag a card into Build and a headless Claude Code agent picks it up. Queue as many as you like; a concurrency limit keeps it sane.' },
  { icon: GitBranch, title: 'Isolated worktrees', body: 'Every feature gets its own branch and git worktree. Your checkout is never touched, and nothing is merged automatically.' },
  { icon: CheckCircle2, title: 'A real pipeline', body: 'Plan → approve → develop → validate ⇄ fix → test → review ⇄ fix → your final approval. Turn each step on or off per project.' },
  { icon: Bell, title: 'Live, with you in the loop', body: 'Stream progress, tokens and estimated cost as they happen. Agents can ask questions, and you get notified when you are needed.' },
  { icon: FileDiff, title: 'Diffs and reports', body: 'A built-in diff viewer, commit list and per-run Markdown reports, with review findings that jump straight to the line.' },
  { icon: GitPullRequest, title: 'One-click pull requests', body: 'When you approve, push the branch and open a GitHub PR, draft or ready, with a generated summary.' },
];

function Features() {
  return (
    <section id="features" className="scroll-mt-14 border-b">
      <Container className="py-16 sm:py-24">
        <SectionHeader eyebrow="Features" title="Manage the board. Let agents build." body="Everything runs on your machine, against your own Claude Code login." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md bg-muted">
                <Icon className="h-4 w-4" />
              </div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" /> Localhost only, no account
          </span>
          <span className="flex items-center gap-1.5">
            <Bot className="h-3.5 w-3.5 text-sky-500" /> Planner and reviewer are read-only
          </span>
          <span className="flex items-center gap-1.5">
            <Laptop className="h-3.5 w-3.5 text-violet-500" /> Mac app or browser
          </span>
        </div>
      </Container>
    </section>
  );
}

function Download() {
  return (
    <section id="download" className="scroll-mt-14 border-b bg-muted/30">
      <Container className="py-16 sm:py-24">
        <SectionHeader eyebrow="Download" title="Get Kanbuild" body="Free forever. Bring your own Claude Code CLI." />
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
          <div className="flex min-w-0 flex-col rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
            <div className="flex items-center gap-2">
              <Apple className="h-5 w-5" />
              <h3 className="font-semibold">macOS app</h3>
              <Badge variant="green" className="ml-auto">
                Recommended
              </Badge>
            </div>
            <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
              Apple silicon and Intel. Node.js is bundled; you only need <code className="font-mono text-xs">git</code> and an authenticated{' '}
              <code className="font-mono text-xs">claude</code> CLI. Open the .dmg and drag Kanbuild to Applications.
            </p>
            <Button asChild size="lg" className="mt-6 w-full">
              <a href={DOWNLOAD_HREF}>
                <Apple /> Download .dmg
              </a>
            </Button>
          </div>
          <div className="flex min-w-0 flex-col rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              <h3 className="font-semibold">Run from source</h3>
              <Badge variant="gray" className="ml-auto">
                Any OS
              </Badge>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">Needs Node 22.13+, git and Claude Code. Then open http://127.0.0.1:4317.</p>
            <pre className="mt-4 flex-1 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-6">
              {`git clone ${GITHUB_URL}.git\ncd autonomous-feature-agent\nnpm install && npm start`}
            </pre>
            <Button asChild size="lg" variant="outline" className="mt-6 w-full">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Github /> Clone on GitHub
              </a>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}

function OpenSource() {
  return (
    <section id="github" className="scroll-mt-14 border-b">
      <Container className="py-16 sm:py-24">
        <div className="mx-auto max-w-3xl rounded-lg border bg-card p-8 text-center text-card-foreground shadow-sm sm:p-12">
          <div className="mx-auto mb-5 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Github className="h-5 w-5" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Built in the open</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Kanbuild is MIT licensed. Read the code, file issues, suggest features or send a pull request. If it saves you time, a star or a small
            donation keeps it going.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Star /> Star on GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">
                <Github /> Issues &amp; ideas
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href="./donate/">
                <Heart /> Donate
              </a>
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{eyebrow}</div>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
