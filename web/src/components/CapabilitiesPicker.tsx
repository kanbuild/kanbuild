import { useEffect, useMemo, useState } from 'react';
import { Plug, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import type { Catalog, McpServerInfo, SkillInfo } from '@shared/types.ts';
import { api } from '@/api';
import { cn } from '@/lib/utils';
import { Badge, type BadgeProps } from './ui/badge';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

const SCOPE_VARIANT: Record<McpServerInfo['scope'], BadgeProps['variant']> = {
  user: 'blue',
  local: 'gray',
  project: 'green',
  plugin: 'violet',
  'claude.ai': 'amber',
};
const STATUS: Record<NonNullable<McpServerInfo['status']>, { label: string; variant: BadgeProps['variant'] }> = {
  connected: { label: 'connected', variant: 'green' },
  failed: { label: 'failed', variant: 'red' },
  needs_auth: { label: 'needs auth', variant: 'amber' },
  pending: { label: 'pending approval', variant: 'gray' },
};
const SOURCE_VARIANT: Record<SkillInfo['source'], BadgeProps['variant']> = { user: 'blue', project: 'green', plugin: 'violet' };

const matches = (q: string, ...fields: (string | undefined)[]) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
};

function Row({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/[0.04]', checked && 'bg-primary/10')}>
      <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/**
 * Lists the MCP servers and skills the local Claude Code installation knows about and lets the user pick
 * which ones this project's agents may use.
 */
export function CapabilitiesPicker({
  repoPath,
  enabled,
  profile,
  mcpServers,
  skills,
  onChange,
}: {
  /** Repository path (catalog is fetched once it is a valid repository). */
  repoPath: string;
  enabled: boolean;
  /** Effective agent profile, for the hints. */
  profile: 'lean' | 'full';
  mcpServers: string[];
  skills: string[];
  onChange: (next: { mcpServers?: string[]; skills?: string[] }) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [tab, setTab] = useState<'mcp' | 'skills'>('mcp');

  const load = (refresh = false) => {
    if (!enabled || !repoPath.trim()) return;
    setLoading(true);
    setError(null);
    api
      .catalog(repoPath, refresh)
      .then(setCatalog)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    setCatalog(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, enabled]);

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id));
  const servers = useMemo(
    () => (catalog?.mcpServers ?? []).filter((s) => (!selectedOnly || mcpServers.includes(s.name)) && matches(query, s.name, s.target, s.scope, s.plugin)),
    [catalog, query, selectedOnly, mcpServers],
  );
  const skillRows = useMemo(
    () => (catalog?.skills ?? []).filter((s) => (!selectedOnly || skills.includes(s.id)) && matches(query, s.name, s.description, s.source, s.plugin)),
    [catalog, query, selectedOnly, skills],
  );
  const knownServers = new Set(catalog?.mcpServers.map((s) => s.name));
  const knownSkills = new Map(catalog?.skills.map((s) => [s.id, s]));
  const claudeAiSelected = mcpServers.some((n) => /^claude\.ai\s/i.test(n));

  const mcpHint = mcpServers.length
    ? claudeAiSelected
      ? 'Only the selected servers can be used. A claude.ai connector is selected, so other configured servers are blocked with --disallowedTools instead of --strict-mcp-config.'
      : 'Only the selected servers are loaded (generated --mcp-config with --strict-mcp-config).'
    : profile === 'lean'
      ? 'Nothing selected: the lean profile loads no MCP servers.'
      : 'Nothing selected: the full profile loads every MCP server configured in Claude Code.';
  const skillHint = skills.length
    ? profile === 'lean'
      ? 'Selected skills are enabled; user and plugin skills are loaded through a session-only plugin.'
      : 'Selected skills are pre-approved. The full profile still lists every installed skill.'
    : profile === 'lean'
      ? 'Nothing selected: the lean profile disables skills.'
      : 'Nothing selected: the full profile loads every installed skill (asking for permission to use them).';

  return (
    <fieldset className="metal-surface space-y-3 rounded-xl p-3">
      <legend className="px-1 text-sm font-semibold">MCP servers &amp; skills</legend>
      <p className="text-[11px] text-muted-foreground">
        Discovered from your local Claude Code: <span className="font-mono">~/.claude.json</span>, the repository&apos;s <span className="font-mono">.mcp.json</span>,{' '}
        <span className="font-mono">claude mcp list</span> (including claude.ai connectors), <span className="font-mono">~/.claude/skills</span>, the repository&apos;s{' '}
        <span className="font-mono">.claude/skills</span> and installed plugins. Choose which ones this project&apos;s agents may use.
      </p>

      {(mcpServers.length > 0 || skills.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {mcpServers.map((n) => (
            <span key={`m-${n}`} className={cn('inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-300', catalog && !knownServers.has(n) && 'bg-red-100 text-red-700 line-through')}>
              <Plug className="h-3 w-3" /> {n}
              <button type="button" aria-label={`Remove ${n}`} onClick={() => onChange({ mcpServers: toggle(mcpServers, n, false) })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {skills.map((id) => (
            <span key={`s-${id}`} className={cn('inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-800 dark:bg-violet-950 dark:text-violet-300', catalog && !knownSkills.has(id) && 'bg-red-100 text-red-700 line-through')}>
              <Sparkles className="h-3 w-3" /> {knownSkills.get(id)?.name ?? id}
              <button type="button" aria-label={`Remove ${id}`} onClick={() => onChange({ skills: toggle(skills, id, false) })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {!enabled ? (
        <p className="rounded-xl border border-dashed p-3 text-center text-xs text-muted-foreground">Enter a valid repository path to list MCP servers and skills.</p>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as 'mcp' | 'skills')}>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="h-8">
              <TabsTrigger value="mcp" className="text-xs">
                <Plug className="h-3.5 w-3.5" /> MCP servers {catalog && <span className="text-muted-foreground">({mcpServers.length}/{catalog.mcpServers.length})</span>}
              </TabsTrigger>
              <TabsTrigger value="skills" className="text-xs">
                <Sparkles className="h-3.5 w-3.5" /> Skills {catalog && <span className="text-muted-foreground">({skills.length}/{catalog.skills.length})</span>}
              </TabsTrigger>
            </TabsList>
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${tab === 'mcp' ? 'MCP servers' : 'skills'}…`} className="h-8 pl-7 text-xs" />
            </div>
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={selectedOnly} onChange={(e) => setSelectedOnly(e.target.checked)} /> Selected only
            </label>
            <button type="button" onClick={() => load(true)} disabled={loading} className="metal-raised rounded-full p-1 text-muted-foreground hover:text-foreground disabled:opacity-50" title="Refresh from Claude Code">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>

          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          {catalog?.warnings.map((w) => (
            <p key={w} className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              {w}
            </p>
          ))}
          {loading && !catalog && <p className="mt-2 text-xs text-muted-foreground">Asking Claude Code for MCP servers and skills… (checking server health can take a few seconds)</p>}

          <TabsContent value="mcp" className="mt-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">{mcpHint}</p>
            <div className="metal-inset max-h-64 space-y-0.5 overflow-y-auto rounded-xl p-1">
              {servers.map((s) => (
                <Row key={s.name} checked={mcpServers.includes(s.name)} onChange={(v) => onChange({ mcpServers: toggle(mcpServers, s.name, v) })}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge variant={SCOPE_VARIANT[s.scope]}>{s.plugin ? `plugin: ${s.plugin}` : s.scope}</Badge>
                    {s.transport !== 'unknown' && <Badge variant="outline">{s.transport}</Badge>}
                    {s.status && <Badge variant={STATUS[s.status].variant}>{STATUS[s.status].label}</Badge>}
                  </span>
                  {s.target && <span className="block truncate font-mono text-[11px] text-muted-foreground">{s.target}</span>}
                </Row>
              ))}
              {catalog && !servers.length && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  {catalog.mcpServers.length ? 'No servers match.' : 'No MCP servers configured in Claude Code. Add one with `claude mcp add`, then refresh.'}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="skills" className="mt-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">{skillHint}</p>
            <div className="metal-inset max-h-64 space-y-0.5 overflow-y-auto rounded-xl p-1">
              {skillRows.map((s) => (
                <Row key={s.id} checked={skills.includes(s.id)} onChange={(v) => onChange({ skills: toggle(skills, s.id, v) })}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{s.name}</span>
                    <Badge variant={SOURCE_VARIANT[s.source]}>{s.plugin ? `plugin: ${s.plugin}` : s.source}</Badge>
                  </span>
                  {s.description && <span className="line-clamp-2 block text-[11px] text-muted-foreground">{s.description}</span>}
                </Row>
              ))}
              {catalog && !skillRows.length && (
                <p className="p-3 text-center text-xs text-muted-foreground">
                  {catalog.skills.length ? 'No skills match.' : 'No skills found in ~/.claude/skills, .claude/skills or installed plugins.'}
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </fieldset>
  );
}
