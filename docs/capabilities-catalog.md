# Capabilities: MCP servers and skills

Source files: `server/src/catalog.ts` (discovery), `server/src/capabilities.ts` (per-run config), `web/src/components/CapabilitiesPicker.tsx` (UI)

Projects choose which MCP servers and skills their agents may use. The choices are stored in `project.mcpServers` (names) and `project.skills` (IDs).

If nothing is selected, the profile default applies:
- **lean**: no MCP servers and no skills.
- **full**: everything, as in an interactive session.

## Discovery (`catalog.ts`)

`ORCH_CLAUDE_HOME` (default the home dir) locates `~/.claude.json` and `~/.claude/`.

### MCP servers

`readMcpConfigs` (line 83) reads these sources; **later sources win** on a name clash:
1. Installed plugins listed in `~/.claude/plugins/installed_plugins.json` (v1 and v2 formats, line 51). Each plugin's servers come from:
   - `.claude-plugin/plugin.json` `mcpServers` (inline or a file path), or
   - `<plugin>/.mcp.json`.

   `${CLAUDE_PLUGIN_ROOT}` is substituted. Scope `plugin`.
2. `~/.claude.json` top-level `mcpServers` → scope `user`.
3. `~/.claude.json` `projects[<repoPath>].mcpServers` → scope `local`.
4. `<repo>/.mcp.json` → scope `project`.

**Status and connectors.** `discoverMcpServers` (line 169) also runs `<claudeBinary> mcp list` (30 s timeout).
- `parseMcpList` (line 134) adds a status: `connected`, `needs_auth`, `pending`, `failed` or null.
- It also adds **claude.ai connectors** (`/^claude\.ai\s/`) with scope `claude.ai` and `launchable:false`.
- If the CLI fails, a warning is added and discovery continues without status.

**Redaction.** `redactTarget` (line 100) removes URL userinfo, query strings, `--*token|key|secret|password*` arguments, and `sk-`, `ghp_`, `gho_` and `xox[bp]` tokens. Raw configs never reach the browser.

### Skills

`discoverSkills` (line 243) scans `~/.claude/skills`, then each plugin's `skills/`, then `<repo>/.claude/skills`.
- Each skill is a `*/SKILL.md`. `parseSkillFrontmatter` (line 198) handles folded and quoted values.
- IDs: `user:<name>`, `project:<name>` or `plugin:<plugin>:<name>`. Deduped and sorted by name.

### Cache

`getCatalog(path, refresh)` (line 256) caches per repo path for 60 s; `refresh:true` bypasses the cache. `cachedCatalog` returns the last result regardless of age. API: `POST /api/catalog {path, refresh}`.

## Per-run preparation (`capabilities.ts`)

`prepareCapabilities(project, profile, {dir, write})` (line 42):
- Returns **null** when nothing is selected, so the profile default applies.
- Otherwise returns `{mcpConfigPath, strictMcp, allowMcp, disallowMcp, skillNames, skillPluginDir, missing}`.
- **Where:**
  - At launch: `dir = RUNS_DIR/<runId>/capabilities`, `write:true`.
  - Launch preview: `write:false`.
  - The code comment at capabilities.ts:31 says `<data dir>/capabilities/<project id>`; that comment is outdated.

**MCP:**
- Selected servers that were found are written to `<dir>/mcp.json` as `{mcpServers}`, mode **0600** (with an explicit chmod).
- Allow rule per server: `mcpToolPrefix(name)` = `mcp__` + the name with `[^A-Za-z0-9_-]` replaced by `_` (e.g. `claude.ai Gmail` → `mcp__claude_ai_Gmail`).
- If a **claude.ai connector** is selected, connectors can't be exported to a file. So `strictMcp=false`, and every known unselected server goes into `disallowMcp` (passed as `--disallowedTools`).
- Selected names that weren't found → `missing` as `mcp:<name>`.

**Skills:**
- Project skills use their plain name.
- **Lean profile:** user and plugin skills are delivered through a session plugin at `<dir>/skills-plugin/`. It contains `.claude-plugin/plugin.json` (name `orch-skills`) and symlinks `skills/<name>`. The model sees them as `orch-skills:<name>`, and the dir is passed with `--plugin-dir`.
- **Full profile:** user skills use their plain name; plugin skills use `<plugin>:<name>`. No plugin dir.
- Selected skills become `Skill(<name>)` allow rules, enable the `Skill` tool and drop `--disable-slash-commands` (see `buildClaudeArgs` in [orchestrator-and-agents.md](orchestrator-and-agents.md#launch-config-and-cli-flags-launchts)).
- Missing skills → `missing` as `skill:<id>`.

Every `missing` entry is logged as a run warning (orchestrator.ts:351).

## UI (`CapabilitiesPicker.tsx`, inside the Project dialog)

- **Loading:** `api.catalog(repoPath, refresh)`; the refresh button bypasses the cache.
- **Selected chips:** sky for MCP, violet for skills. A chip turns red with strikethrough when it is missing from the catalog.
- **Tabs:** "MCP servers" and "Skills".
- **Filtering:** multi-word AND search and a "Selected only" filter.
- **MCP rows** show badges for scope, transport and status. **Skill rows** show a source badge and a description.
- **Hints** explain the effect on the CLI: `--strict-mcp-config` vs the connector case, and lean-with-nothing-selected vs full.
- Catalog warnings are shown in amber.

Tests: `server/test/capabilities.test.ts`.
