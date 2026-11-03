import type { ReactNode } from 'react';
import {
  Apple,
  ArrowUp,
  Bell,
  Bot,
  CheckCircle2,
  ClipboardList,
  Code2,
  FileDiff,
  FlaskConical,
  GitBranch,
  GitPullRequest,
  Github,
  Heart,
  Laptop,
  ScanSearch,
  ShieldCheck,
  Star,
  Terminal,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Container, Page } from './Chrome';
import { GITHUB_URL } from './config';

/** The download button leads to the donate page, which starts the download itself. */
const DOWNLOAD_HREF = './donate/?download=1';

export function Home() {
  return (
    <Page home="./">
      <Hero />
      <Features />
      <Download />
      <OpenSource />
    </Page>
  );
}

/** Modeled on Emergent's prompt home: pill, chrome headline, metal composer with tab chips, suggestion chips. */
function Hero() {
  return (
    <section>
      <Container className="flex flex-col items-center pb-16 pt-16 text-center sm:pb-24 sm:pt-24">
        <span className="metal-raised inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--accent-glow))]" /> Free &amp; open source · MIT
        </span>
        <h1 className="chrome-text mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl sm:leading-[1.05]">
          Drag a card.
          <br />
          Ship a branch.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          A local-first Kanban board for your git repos. Move a feature into <span className="font-medium text-foreground">Build</span> and Claude Code
          agents plan, implement, validate, test and review it in an isolated worktree, while you watch every step live.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" className="sheen px-6">
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

        <ComposerMock />
        <BoardMock />
      </Container>
    </section>
  );
}

const STEPS = [
  { icon: ClipboardList, label: 'Plan' },
  { icon: Code2, label: 'Develop' },
  { icon: CheckCircle2, label: 'Validate' },
  { icon: FlaskConical, label: 'Test' },
  { icon: ScanSearch, label: 'Review' },
  { icon: GitPullRequest, label: 'Open PR' },
];

/** Static picture of the dashboard's feature composer (not an input). */
function ComposerMock() {
  return (
    <div className="mt-14 w-full max-w-2xl text-left" aria-label="Feature composer preview">
      <div className="flex gap-1 pl-3">
        {['New feature', 'Follow-up', 'Bug fix'].map((t, i) => (
          <span
            key={t}
            className={cn(
              'inline-flex h-8 items-center rounded-t-xl px-3 text-xs font-medium',
              i === 0 ? 'metal-surface border-b-0 text-foreground' : 'text-muted-foreground',
            )}
          >
            {t}
          </span>
        ))}
      </div>
      <div className="metal-surface rounded-2xl p-4 shadow-glow">
        <div className="text-sm font-medium">Add dark mode to the settings page</div>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Follow the OS by default, store the choice, and keep the existing tokens. Add a toggle next to the account menu.
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge variant="secondary">
              <GitBranch className="h-3 w-3" /> main
            </Badge>
            <Badge variant="gray">priority: medium</Badge>
          </div>
          <span className="metal-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
            <ArrowUp className="h-4 w-4" />
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {STEPS.map(({ icon: Icon, label }) => (
          <span key={label} className="metal-raised inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground">
            <Icon className="h-3.5 w-3.5 text-primary" /> {label}
          </span>
        ))}
      </div>
    </div>
  );
}

type MockCard = { title: string; badge: ReactNode; meta?: string; progress?: number | null; running?: boolean; attention?: boolean };

const COLUMNS: { name: string; count: number; cards: MockCard[] }[] = [
  {
    name: 'Backlog',
    count: 2,
    cards: [
      { title: 'Dark mode toggle', badge: <Badge variant="gray" dot>backlog</Badge>, meta: 'priority: medium' },
      { title: 'CSV export for reports', badge: <Badge variant="gray" dot>blocked</Badge>, meta: 'depends on: Reports API' },
    ],
  },
  {
    name: 'Build',
    count: 2,
    cards: [
      { title: 'Reports API', badge: <Badge variant="blue" dot>running</Badge>, meta: 'Develop · #1 · 48.2k tok · est. $0.41', progress: null, running: true },
      { title: 'OAuth login', badge: <Badge variant="amber" dot>approve plan</Badge>, meta: 'Plan ready for review', attention: true },
    ],
  },
  {
    name: 'Done',
    count: 1,
    cards: [{ title: 'Rate limiting', badge: <Badge variant="green" dot>done</Badge>, meta: 'PR #42 opened', progress: 100 }],
  },
];

function BoardMock() {
  return (
    <div className="metal-glass mt-16 w-full max-w-5xl rounded-3xl p-3 text-left sm:p-4" aria-label="Kanbuild board preview">
      <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
        <span className="metal-raised inline-flex h-7 items-center gap-2 rounded-lg px-2.5 text-sm font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> acme-web
        </span>
        <span className="metal-raised inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-mono text-[11px] text-muted-foreground">
          <GitBranch className="h-3 w-3 text-primary" /> main
        </span>
        <Badge variant="gold" className="ml-auto">
          est. ~$1.27
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.name} className="metal-inset rounded-2xl p-2">
            <div className="mb-2 flex items-center justify-between px-1.5 pt-0.5">
              <span className="text-xs font-semibold">{col.name}</span>
              <span className="text-[10px] text-muted-foreground">{col.count}</span>
            </div>
            <div className="space-y-2">
              {col.cards.map((c) => (
                <div
                  key={c.title}
                  className={cn(
                    'metal-surface relative rounded-xl p-2.5',
                    c.running && 'running-edge',
                    c.attention && 'ring-1 ring-amber-400/70',
                  )}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">{c.badge}</div>
                  <div className="text-xs font-medium leading-snug">{c.title}</div>
                  {c.meta && <div className="mt-1 text-[10px] text-muted-foreground">{c.meta}</div>}
                  {c.progress !== undefined && (
                    <div className="mt-2">
                      <Progress value={c.progress} tone={c.progress === 100 ? 'green' : 'default'} />
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
    <section id="features" className="scroll-mt-20">
      <Container className="py-16 sm:py-24">
        <SectionHeader eyebrow="Features" title="Manage the board. Let agents build." body="Everything runs on your machine, against your own Claude Code login." />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="metal-surface sheen rounded-2xl p-5">
              <div className="metal-inset mb-4 flex h-10 w-10 items-center justify-center rounded-xl">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {[
            { icon: ShieldCheck, label: 'Localhost only, no account' },
            { icon: Bot, label: 'Planner and reviewer are read-only' },
            { icon: Laptop, label: 'Mac app or browser' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="metal-raised inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground">
              <Icon className="h-3.5 w-3.5 text-primary" /> {label}
            </span>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Download() {
  return (
    <section id="download" className="scroll-mt-20">
      <Container className="py-16 sm:py-24">
        <SectionHeader eyebrow="Download" title="Get Kanbuild" body="Free forever. Bring your own Claude Code CLI." />
        <div className="mx-auto mt-12 grid max-w-4xl gap-4 md:grid-cols-2">
          <div className="metal-surface flex min-w-0 flex-col rounded-2xl p-6 shadow-glow">
            <div className="flex items-center gap-2.5">
              <div className="metal-chrome flex h-9 w-9 items-center justify-center rounded-xl">
                <Apple className="h-4 w-4 text-[hsl(var(--accent-hi))]" />
              </div>
              <h3 className="font-semibold">macOS app</h3>
              <Badge variant="green" dot className="ml-auto">
                Recommended
              </Badge>
            </div>
            <p className="mt-4 flex-1 text-sm leading-6 text-muted-foreground">
              Apple silicon and Intel. Node.js is bundled; you only need <code className="metal-inset rounded-md px-1 font-mono text-xs">git</code> and an
              authenticated <code className="metal-inset rounded-md px-1 font-mono text-xs">claude</code> CLI. Open the .dmg and drag Kanbuild to
              Applications.
            </p>
            <Button asChild size="lg" className="sheen mt-6 w-full">
              <a href={DOWNLOAD_HREF}>
                <Apple /> Download .dmg
              </a>
            </Button>
          </div>
          <div className="metal-surface flex min-w-0 flex-col rounded-2xl p-6">
            <div className="flex items-center gap-2.5">
              <div className="metal-inset flex h-9 w-9 items-center justify-center rounded-xl">
                <Terminal className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold">Run from source</h3>
              <Badge variant="gray" className="ml-auto">
                Any OS
              </Badge>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">Needs Node 22.13+, git and Claude Code. Then open http://127.0.0.1:4317.</p>
            <pre className="metal-inset mt-4 flex-1 overflow-x-auto rounded-xl p-3 font-mono text-xs leading-6">
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
    <section id="github" className="scroll-mt-20">
      <Container className="py-16 sm:py-24">
        <div className="metal-glass mx-auto max-w-3xl rounded-3xl p-8 text-center sm:p-12">
          <div className="metal-chrome mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Github className="h-5 w-5 text-[hsl(var(--accent-hi))]" />
          </div>
          <h2 className="chrome-text text-3xl font-semibold tracking-tight">Built in the open</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Kanbuild is MIT licensed. Read the code, file issues, suggest features or send a pull request. If it saves you time, a star or a small
            donation keeps it going.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {['MIT', 'Local-first', 'Never auto-merges', 'No telemetry'].map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild variant="chrome">
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                <Star /> Star on GitHub
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">
                <Github /> Issues &amp; ideas
              </a>
            </Button>
            <Button asChild variant="gold">
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
      <span className="metal-raised inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {eyebrow}
      </span>
      <h2 className="chrome-text mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}
