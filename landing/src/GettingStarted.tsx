import type { ReactNode } from 'react';
import { AlertTriangle, Apple, ArrowRight, Github, KeyRound, Lightbulb, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Container, Page } from './Chrome';
import { GITHUB_URL } from './config';

const DOWNLOAD_HREF = '../donate/?download=1';
/** Screenshots live in landing/public/screenshots (regenerate with landing/scripts/screenshots.mjs). */
const SHOTS = '../screenshots/';

/** Typography for the step bodies (the landing page defines no CSS of its own). */
const PROSE = cn(
  'text-sm leading-7 text-muted-foreground sm:text-[15px]',
  '[&_p]:mt-3 [&_p:first-child]:mt-0 [&_strong]:font-semibold [&_strong]:text-foreground',
  '[&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_li]:pl-1',
  // Links in running text only, so Button links keep their own colors.
  '[&_:is(p,li,dd)>a]:font-medium [&_:is(p,li,dd)>a]:text-primary hover:[&_:is(p,li,dd)>a]:underline',
  '[&_dt]:mt-4 [&_dt:first-child]:mt-0 [&_dt]:font-semibold [&_dt]:text-foreground [&_dd]:mt-1',
);

type Step = { id: string; title: string; body: ReactNode };

const STEPS: Step[] = [
  {
    id: 'prerequisites',
    title: 'Check the prerequisites',
    body: (
      <>
        <p>Kanbuild runs on your machine and drives the Claude Code CLI you already use. You need:</p>
        <ul>
          <li>
            <strong>git</strong> on your PATH, and the repositories you want to work on cloned locally.
          </li>
          <li>
            <strong>Claude Code</strong> installed and logged in. Run <Code>claude</Code> once in a terminal and finish the login. Kanbuild uses that login, so
            there is no API key to paste and no account to create.
          </li>
          <li>
            <strong>Node.js 22.13+</strong>, only if you run from source. The Mac app bundles its own Node.
          </li>
        </ul>
        <Pre>{`git --version
claude --version   # then run \`claude\` once to log in`}</Pre>
      </>
    ),
  },
  {
    id: 'install',
    title: 'Install Kanbuild',
    body: (
      <>
        <p>
          <strong>macOS app (recommended).</strong> Download the .dmg, open it and drag Kanbuild to Applications. If macOS says the app can’t be checked,
          try to open it once, then go to System Settings → Privacy &amp; Security and click <strong>Open Anyway</strong>. The app finds{' '}
          <Code>claude</Code>, <Code>git</Code> and <Code>npm</Code> through your login shell’s PATH.
        </p>
        <div className="my-4 flex flex-wrap gap-2">
          <Button asChild className="sheen">
            <a href={DOWNLOAD_HREF}>
              <Apple /> Download for macOS
            </a>
          </Button>
        </div>
        <p>
          <strong>From source (any OS).</strong> Clone the repo, install and start. The dashboard opens at <Code>http://127.0.0.1:4317</Code>.
        </p>
        <Pre>{`git clone ${GITHUB_URL}.git
cd autonomous-feature-agent
npm install
npm start`}</Pre>
        <p>Both versions run the same local backend. It only listens on 127.0.0.1, and your data lives in ~/.local-orchestrator.</p>
      </>
    ),
  },
  {
    id: 'project',
    title: 'Add your first project',
    body: (
      <>
        <p>
          On first launch the board is empty. Click <strong>Add project</strong> and paste the path to a local git repository. Kanbuild checks it and fills
          in the name, the base branch new features start from, and a worktree directory next to the repo. Nothing in your repository is changed: every
          feature gets its own branch and worktree in that directory.
        </p>
        <Shot name="empty" alt="Kanbuild's first-launch screen with an Add project button" />
        <Shot name="add-project" alt="The Add project dialog with a validated repository path, name, base branch and worktree directory" narrow />
      </>
    ),
  },
  {
    id: 'pipeline',
    title: 'Choose the pipeline',
    body: (
      <>
        <p>
          Open <strong>Project settings → Pipeline</strong> to decide what happens when a card enters Build. Each step can be switched on or off per project:
        </p>
        <ul>
          <li>
            <strong>Plan</strong> and <strong>Approve the plan</strong>: a read-only planner writes a plan and waits for your OK before any code is
            written.
          </li>
          <li>
            <strong>Validate</strong>: Kanbuild runs your build, lint and test commands after each change. It detects them from package.json, or you list
            your own. Failures go back to the developer agent automatically.
          </li>
          <li>
            <strong>Tester</strong> and <strong>Reviewer</strong>: separate agents add tests and review the diff. Requested changes loop back, up to the
            max fix rounds.
          </li>
          <li>
            <strong>Final approval</strong>: the feature pauses before Done so you can read the diff.
          </li>
        </ul>
        <p>You can also choose per role models and effort, which MCP servers and skills agents may use, and whether cards start automatically or wait for ▶.</p>
        <Shot name="project-pipeline" alt="Project settings, Pipeline section with plan, validate, tester, reviewer and approval toggles" narrow />
      </>
    ),
  },
  {
    id: 'feature',
    title: 'Add a feature card',
    body: (
      <>
        <p>
          Use the quick add box at the top of <strong>Backlog</strong>, or <strong>New feature</strong> in the top bar. Write what you want as you would to
          a teammate. Type <Code>@</Code> to reference files in the repo, pick a priority, and use <strong>More options</strong> to make a card depend on
          another one. A dependent card waits until the other is done, then builds on top of its branch.
        </p>
        <Shot name="quick-add" alt="The Backlog quick add composer with a title, description, priority tabs and an @file reference" small />
      </>
    ),
  },
  {
    id: 'build',
    title: 'Drag it into Build and watch',
    body: (
      <>
        <p>
          Drag the card into <strong>Build</strong>. An agent starts in a fresh worktree on a new branch (a concurrency limit queues the rest). The card
          shows the current step, progress, tokens and an estimated cost. Click a card to open its detail sheet:
        </p>
        <ul>
          <li>
            <strong>Overview</strong>: what the agent is doing right now, plus stats.
          </li>
          <li>
            <strong>Pipeline</strong>: every step and run in this cycle, with costs.
          </li>
          <li>
            <strong>Activity</strong>: a live stream of tool calls, edits and commands.
          </li>
          <li>
            <strong>Changes</strong>, <strong>Tests</strong>, <strong>Report</strong> and <strong>Terminal</strong>: the diff, test results, the run report,
            and a shell inside the worktree.
          </li>
        </ul>
        <Shot name="board" alt="The Kanbuild board with cards in Backlog, Build and Done" />
        <Shot name="agent-activity" alt="The detail sheet of a running feature showing its live activity stream" />
        <Shot name="agent-pipeline" alt="The Pipeline tab: Plan and Approve plan done, Develop running, later steps pending" />
      </>
    ),
  },
  {
    id: 'approve',
    title: 'Answer checkpoints',
    body: (
      <>
        <p>
          When an agent needs you, its card glows gold and you get a notification. Approve the plan or ask for changes, answer clarifying questions (leave
          one blank to let the agent decide), and give the final approval. Every checkpoint takes a comment that goes straight back to the agent.
        </p>
        <Shot name="plan-approval" alt="A plan approval checkpoint with the plan, a comment box, and Approve and implement / Request plan changes buttons" />
      </>
    ),
  },
  {
    id: 'review',
    title: 'Review the diff and finish',
    body: (
      <>
        <p>
          The <strong>Changes</strong> tab lists the branch’s commits and files with a unified or split diff. Review findings link straight to the line.
          Open the worktree in your editor, or run commands in the Terminal tab to try it. When you’re happy, click <strong>Approve → Done</strong>. Want
          more? Type a follow-up on a finished card and the agent resumes the same session.
        </p>
        <Shot name="changes" alt="The Changes tab with the final approval checkpoint, branch details and a diff" />
        <Callout icon={Lightbulb}>Kanbuild never merges, force-pushes or deletes branches. Merging stays your call.</Callout>
      </>
    ),
  },
  {
    id: 'github',
    title: 'Connect GitHub with a personal access token',
    body: (
      <>
        <p>
          To push branches and open pull requests from Kanbuild, add a GitHub personal access token (PAT). It’s optional: without one, everything else
          works and you push yourself.
        </p>
        <ol>
          <li>
            On GitHub, open{' '}
            <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
              Settings → Developer settings → Fine-grained tokens → Generate new token
            </a>
            .
          </li>
          <li>Name it (for example “Kanbuild”), pick an expiration, and choose the resource owner that owns your repos.</li>
          <li>
            Under <strong>Repository access</strong>, pick <strong>Only select repositories</strong> and choose the repos you added as projects.
          </li>
          <li>
            Under <strong>Repository permissions</strong>, set <strong>Contents: Read and write</strong> and <strong>Pull requests: Read and write</strong>.
            Metadata: Read-only is added automatically.
          </li>
          <li>
            Generate the token and copy it (it starts with <Code>github_pat_</Code>).
          </li>
          <li>
            In Kanbuild, open <strong>Settings</strong> (bottom left), paste it in the <strong>GitHub</strong> section and click <strong>Save token</strong>.
            You should see <em>Connected as @you</em>.
          </li>
        </ol>
        <Shot name="settings-github" alt="Settings, GitHub section showing Connected as @octocat and the token field" narrow />
        <p>
          A classic token with the <Code>repo</Code> scope also works. For an organization that requires SSO, authorize the token for that org. You can set{' '}
          <Code>ORCH_GITHUB_TOKEN</Code> in the environment instead of saving it in the app.
        </p>
        <Callout icon={KeyRound}>
          The token is checked against GitHub before it’s saved, stored in ~/.local-orchestrator/github-token with 0600 permissions, never sent back to
          the browser and never passed to agents. It’s only used to push feature branches and open pull requests.
        </Callout>
        <p>
          Then use <strong>Create PR</strong> on a feature, or turn on <strong>Open a PR automatically when Done</strong> in Project settings → Pipeline.
          PRs are drafts by default, with a generated summary. The project’s remote must point at GitHub (GitHub Enterprise works too).
        </p>
      </>
    ),
  },
  {
    id: 'settings',
    title: 'Tune your defaults',
    body: (
      <>
        <p>Global settings apply to every project unless a project overrides them:</p>
        <ul>
          <li>
            <strong>Agent profile</strong> and <strong>effort</strong>: the lean profile keeps token use down.
          </li>
          <li>
            <strong>Budget per run</strong>: a hard stop per agent run (0 = none). <strong>Max concurrent agents</strong>: the rest wait in a queue.
          </li>
          <li>
            <strong>Start automatically</strong> when a card enters Build, or wait for ▶.
          </li>
          <li>
            <strong>Default model</strong>, your <strong>editor</strong> for Open in editor, and the <strong>Claude Code binary</strong> if{' '}
            <Code>claude</Code> isn’t on your PATH.
          </li>
          <li>
            <strong>Notifications</strong>: desktop or macOS system notifications for checkpoints and failures.
          </li>
        </ul>
        <Shot name="settings" alt="The global Settings dialog" narrow />
      </>
    ),
  },
  {
    id: 'demo',
    title: 'Try it without spending tokens',
    body: (
      <>
        <p>
          From source, you can point Kanbuild at the fake Claude CLI used by the test suite. It plays every role, writes commits and reports, and costs
          nothing. It’s a good way to learn the flow first.
        </p>
        <Pre>{`ORCH_CLAUDE_BIN=$PWD/server/test/fixtures/fake-claude.mjs npm start`}</Pre>
      </>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    body: (
      <>
        <dl>
          <dt>“Port 4317 is already in use”</dt>
          <dd>
            Another Kanbuild (the Mac app or another <Code>npm start</Code>) is running. Use that one, or start this one with <Code>ORCH_PORT=4318</Code>.
          </dd>
          <dt>Agents fail right away with “claude: not found”</dt>
          <dd>
            Set the full path in Settings → Claude Code binary (find it with <Code>which claude</Code>).
          </dd>
          <dt>Create PR fails</dt>
          <dd>
            Check the token’s repository access and its Contents and Pull requests permissions, that the token hasn’t expired, and that the project’s git
            remote points at GitHub.
          </dd>
          <dt>Validation fails on a fresh worktree</dt>
          <dd>Add your real commands under Project settings → Pipeline → Validation commands, one per line.</dd>
          <dt>Costs look high</dt>
          <dd>
            Costs are estimates from public API prices. Claude subscription plans aren’t billed per token. Use the lean profile, a cheaper reviewer model, or
            a budget per run.
          </dd>
        </dl>
        <p>
          Still stuck?{' '}
          <a href={`${GITHUB_URL}/issues`} target="_blank" rel="noopener noreferrer">
            Open an issue on GitHub
          </a>
          .
        </p>
      </>
    ),
  },
];

export function GettingStarted() {
  return (
    <Page home="../">
      <Container className="pb-10 pt-14 text-center sm:pt-20">
        <span className="metal-raised inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Guide
        </span>
        <h1 className="chrome-text mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Get started with Kanbuild</h1>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-muted-foreground">
          From install to your first approved build, and a pull request on GitHub, in about ten minutes.
        </p>
      </Container>

      <Container className="pb-16 sm:pb-24">
        <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
          <aside className="hidden lg:block">
            <nav className="metal-glass sticky top-24 rounded-2xl p-3" aria-label="Steps">
              <ol className="space-y-0.5 text-sm">
                {STEPS.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="flex gap-2 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground">
                      <span className="w-4 shrink-0 text-right text-xs leading-5 text-primary">{i + 1}</span>
                      <span className="leading-5">{s.title}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>

          <div className="min-w-0 space-y-6">
            {STEPS.map((s, i) => (
              <section key={s.id} id={s.id} className="metal-surface scroll-mt-24 rounded-3xl p-5 sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="metal-accent flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">{i + 1}</span>
                  <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{s.title}</h2>
                </div>
                <div className={cn("mt-4", PROSE)}>{s.body}</div>
              </section>
            ))}

            <div className="metal-glass rounded-3xl p-8 text-center">
              <h2 className="chrome-text text-2xl font-semibold tracking-tight">Ready to build?</h2>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Button asChild className="sheen">
                  <a href={DOWNLOAD_HREF}>
                    <Apple /> Download for macOS
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                    <Github /> Run from source
                  </a>
                </Button>
                <Button asChild variant="ghost">
                  <a href="../">
                    Back to home <ArrowRight />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </Page>
  );
}

/** A real screenshot of the app, in both themes; the one matching the current theme is shown. */
function Shot({ name, alt, narrow, small }: { name: string; alt: string; narrow?: boolean; small?: boolean }) {
  return (
    <figure className={cn('my-5', narrow && 'mx-auto max-w-xl', small && 'mx-auto max-w-sm')}>
      <div className="metal-glass overflow-hidden rounded-2xl p-1.5">
        <img src={`${SHOTS}${name}.light.jpg`} alt={alt} loading="lazy" decoding="async" className="block w-full rounded-xl dark:hidden" />
        <img src={`${SHOTS}${name}.dark.jpg`} alt={alt} loading="lazy" decoding="async" className="hidden w-full rounded-xl dark:block" />
      </div>
    </figure>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="metal-inset rounded-md px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
}

function Pre({ children }: { children: string }) {
  return (
    <div className="relative my-4">
      <Terminal className="absolute right-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
      <pre className="metal-inset overflow-x-auto rounded-xl p-3 pr-9 font-mono text-xs leading-6">{children}</pre>
    </div>
  );
}

function Callout({ icon: Icon = AlertTriangle, children }: { icon?: typeof AlertTriangle; children: ReactNode }) {
  return (
    <div className="metal-inset my-4 flex gap-3 rounded-xl p-3 text-sm leading-6 text-muted-foreground">
      <Icon className="mt-1 h-4 w-4 shrink-0 text-primary" />
      <div>{children}</div>
    </div>
  );
}
