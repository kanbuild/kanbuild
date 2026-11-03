import type { ReactNode } from 'react';
import {
  Apple,
  Ban,
  Bell,
  BookOpen,
  Bot,
  CheckCircle2,
  Circle,
  ExternalLink,
  FileDiff,
  FileText,
  GitBranch,
  GitPullRequest,
  Github,
  Heart,
  Laptop,
  LayoutGrid,
  Loader2,
  Pencil,
  ShieldCheck,
  Star,
  Terminal,
  Workflow,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { Container, Page } from './Chrome';
import { GITHUB_URL } from './config';

/** The download button leads to the donate page, which starts the download itself. */
const DOWNLOAD_HREF = './donate/?download=1';
const GETTING_STARTED_HREF = './getting-started/';

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

/** Board-first hero: pill, chrome headline, then the board with an agent's detail sheet open over it. */
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
          Ship a build.
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
        <p className="mt-4 text-xs text-muted-foreground">
          Apple silicon &amp; Intel · Needs git and the Claude Code CLI · Also runs in your browser ·{' '}
          <a href={GETTING_STARTED_HREF} className="font-medium text-primary hover:underline">
            Getting started guide →
          </a>
        </p>

        <div className="mt-14 w-full max-w-6xl text-left">
          <BoardMock />
          <div className="relative z-10 flex flex-col gap-4 px-0 lg:-mt-14 lg:flex-row lg:items-start lg:gap-8 lg:px-8">
            <div className="max-w-sm pt-2 lg:pt-24">
              <span className="metal-raised inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" /> Live
              </span>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">Open a card to watch its agent work</h2>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                Every step of the pipeline, each tool call and edit as it happens, tokens and an estimated cost. Step in at any checkpoint.
              </p>
            </div>
            <AgentSheetMock />
          </div>
        </div>
      </Container>
    </section>
  );
}

type MockCard = {
  title: string;
  badge: ReactNode;
  meta?: string;
  progress?: number | null;
  running?: boolean;
  attention?: boolean;
  selected?: boolean;
  dashed?: boolean;
};

const COLUMNS: { name: string; hint: string; cards: MockCard[] }[] = [
  {
    name: 'Backlog',
    hint: 'Drag a card into Build to start an agent',
    cards: [
      { title: 'Dark mode for the settings page', badge: <Badge variant="gray" dot>medium</Badge>, meta: 'Follow the OS, store the choice' },
      { title: 'CSV export for reports', badge: <Badge variant="gray" dot>low</Badge>, meta: 'Waits for Reports API', dashed: true },
      { title: 'Onboarding email sequence', badge: <Badge variant="gray" dot>low</Badge>, meta: 'Three emails over the first week' },
    ],
  },
  {
    name: 'Build',
    hint: '1 running · 2 waiting · limit 2 concurrent',
    cards: [
      { title: 'Reports API', badge: <Badge variant="blue" dot>running</Badge>, meta: 'Develop · #2 · 10.5k tok · est. ~$0.07', progress: null, running: true, selected: true },
      { title: 'OAuth login with GitHub', badge: <Badge variant="gold">Approve plan</Badge>, meta: 'Waiting for plan approval', attention: true },
      { title: 'Invoice PDF download', badge: <Badge variant="gold">Awaiting approval</Badge>, meta: 'Validated · tested · reviewed', attention: true, progress: 100 },
    ],
  },
  {
    name: 'Done',
    hint: 'Completed features ready for review',
    cards: [
      { title: 'Rate limiting for the public API', badge: <Badge variant="green" dot>done</Badge>, meta: 'PR #42 opened', progress: 100 },
      { title: 'Audit log for admin actions', badge: <Badge variant="green" dot>done</Badge>, meta: 'PR #39 merged by you', progress: 100 },
    ],
  },
];

/** Static picture of the dashboard's board. The extra bottom padding on lg is where the agent sheet overlaps it. */
function BoardMock() {
  return (
    <div className="metal-glass w-full rounded-3xl p-3 shadow-glow sm:p-4 lg:pb-20" aria-label="Kanbuild board preview">
      <div className="mb-3 flex flex-wrap items-center gap-2 px-1">
        <span className="metal-accent inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold">
          <LayoutGrid className="h-3.5 w-3.5" /> Board
        </span>
        <span className="metal-raised inline-flex h-7 items-center gap-2 rounded-full px-3 text-xs font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" /> acme-web
        </span>
        <span className="metal-raised hidden h-7 items-center gap-1.5 rounded-full px-2.5 font-mono text-[11px] text-muted-foreground sm:inline-flex">
          <GitBranch className="h-3 w-3 text-primary" /> base main
        </span>
        <Badge variant="gold" className="ml-auto">
          est. ~$0.48
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <div key={col.name} className="metal-inset rounded-2xl p-2">
            <div className="flex items-center justify-between px-1.5 pt-0.5">
              <span className="text-xs font-semibold">{col.name}</span>
              <span className="text-[10px] text-muted-foreground">{col.cards.length}</span>
            </div>
            <div className="mb-2 truncate px-1.5 text-[10px] text-muted-foreground">{col.hint}</div>
            <div className="space-y-2">
              {col.cards.map((c) => (
                <div
                  key={c.title}
                  className={cn(
                    'metal-surface relative rounded-xl p-2.5',
                    c.running && 'running-edge',
                    c.attention && 'shadow-gold-glow ring-1 ring-amber-400/70',
                    c.selected && 'ring-2 ring-primary/70',
                    c.dashed && 'border-dashed',
                  )}
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">{c.badge}</div>
                  <div className="text-xs font-medium leading-snug">{c.title}</div>
                  {c.meta && <div className="mt-1 text-[10px] text-muted-foreground">{c.meta}</div>}
                  {c.progress !== undefined && (
                    <div className="mt-2">
                      <Progress value={c.progress} tone={c.progress === 100 ? (c.attention ? 'default' : 'green') : 'default'} />
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

type StepState = 'done' | 'active' | 'todo';
const PIPELINE: { label: string; state: StepState }[] = [
  { label: 'Plan', state: 'done' },
  { label: 'Approve plan', state: 'done' },
  { label: 'Develop', state: 'active' },
  { label: 'Validate', state: 'todo' },
  { label: 'Tests', state: 'todo' },
  { label: 'Review', state: 'todo' },
  { label: 'Your approval', state: 'todo' },
];

const ACTIVITY: { time: string; icon: typeof Bot; text: string; tool?: boolean; ok?: boolean }[] = [
  { time: '11:05:22', icon: Bot, text: 'Reusing worktree feature-reports-api (branch feature/reports-api)' },
  { time: '11:05:23', icon: FileText, text: 'Read src/reports.js', tool: true },
  { time: '11:05:31', icon: Pencil, text: 'Edit src/reports.js  +38 −4', tool: true, ok: true },
  { time: '11:05:44', icon: Pencil, text: 'Write src/routes/reports.ts', tool: true, ok: true },
  { time: '11:05:52', icon: Terminal, text: 'Bash npm test -- reports', tool: true },
];

const SHEET_TABS = ['Overview', 'Pipeline', 'Activity', 'Changes', 'Tests', 'Report', 'Terminal'];

/** Static picture of the detail sheet for the running "Reports API" card. */
function AgentSheetMock() {
  return (
    <div
      className="metal-surface w-full min-w-0 overflow-hidden rounded-3xl shadow-2xl lg:flex-1"
      aria-label="Agent detail preview"
    >
      <div className="border-b border-border/60 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="red" dot>
            High
          </Badge>
          <Badge variant="blue">
            <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> Running
          </Badge>
          <Badge variant="violet" dot>
            Develop
          </Badge>
          <span className="text-[11px] text-muted-foreground">Developer · run #2</span>
          <span className="metal-raised ml-auto flex h-6 w-6 items-center justify-center rounded-full">
            <X className="h-3 w-3 text-muted-foreground" />
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">Reports API</h3>
          <span className="metal-raised inline-flex h-6 items-center gap-1 rounded-full px-2 font-mono text-[10px] text-muted-foreground">
            <GitBranch className="h-3 w-3 text-primary" /> feature/reports-api
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {[
            { icon: Ban, label: 'Cancel agent' },
            { icon: ExternalLink, label: 'Open in editor' },
          ].map(({ icon: Icon, label }) => (
            <span key={label} className="metal-raised inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium">
              <Icon className="h-3.5 w-3.5" /> {label}
            </span>
          ))}
        </div>
      </div>

      <div className="p-4">
        <div className="flex flex-wrap items-center gap-1">
          {PIPELINE.map((s, i) => (
            <span key={s.label} className="flex items-center gap-1">
              <span
                className={cn(
                  'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-medium',
                  s.state === 'done' && 'metal-raised border-transparent text-foreground',
                  s.state === 'active' && 'border-primary/70 bg-primary/10 text-foreground shadow-glow',
                  s.state === 'todo' && 'border-dashed border-border text-muted-foreground',
                )}
              >
                {s.state === 'done' ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : s.state === 'active' ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary motion-reduce:animate-none" />
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                {s.label}
              </span>
              {i < PIPELINE.length - 1 && <span className="h-px w-2 bg-border" />}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Implementing · Writing src/routes/reports.ts</span>
          <span>40%</span>
        </div>
        <div className="mt-1.5">
          <Progress value={40} />
        </div>

        <div className="mt-4 flex gap-3 overflow-hidden border-b border-border/60 text-[11px]">
          {SHEET_TABS.map((t) => (
            <span key={t} className={cn('shrink-0 pb-1.5', t === 'Activity' ? 'border-b-2 border-primary font-semibold text-foreground' : 'text-muted-foreground')}>
              {t}
            </span>
          ))}
        </div>
        <div className="mt-2 space-y-1.5">
          {ACTIVITY.map((a, i) => (
            <div
              key={a.time + a.text}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 font-mono text-[10.5px]',
                a.tool ? 'metal-raised' : 'text-violet-600 dark:text-violet-300',
              )}
            >
              <span className="shrink-0 text-muted-foreground">{a.time}</span>
              {a.ok ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" /> : <a.icon className="h-3 w-3 shrink-0 text-primary" />}
              <span className="truncate">{a.text}</span>
              {i === ACTIVITY.length - 1 && <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />}
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Duration', '0:41'],
            ['New tokens', '10.5k'],
            ['Est. cost', '~$0.07'],
            ['Turns', '7'],
          ].map(([k, v]) => (
            <div key={k} className="metal-inset rounded-xl px-2.5 py-2">
              <div className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{k}</div>
              <div className="mt-0.5 text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>
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
        <div className="mt-8 flex justify-center">
          <Button asChild variant="chrome">
            <a href={GETTING_STARTED_HREF}>
              <BookOpen /> Read the getting started guide
            </a>
          </Button>
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
