import fs from 'node:fs';
import { getFeature, patchFeatureState } from './features.ts';
import { GithubError, createPullRequest, findOpenPr, getToken, parseRemote, pushBranch, remoteHasBranch, remoteUrl } from './github.ts';
import { notify } from './notify.ts';
import { HttpError, getProject } from './projects.ts';
import { addEvent, getReport, latestCycle, listCycleRuns } from './runs.ts';
import { ACTIVE_AGENT_STATUSES, type Feature, type Project, type Report } from '../../shared/types.ts';

/** Pull request description assembled from the latest pipeline cycle's reports. */
export function buildPrBody(feature: Feature, project: Project): string {
  const runs = listCycleRuns(feature.id, latestCycle(feature.id));
  const reports = runs.map((r) => ({ run: r, report: getReport(r.id) })).filter((x): x is { run: typeof x.run; report: Report } => !!x.report);
  const dev = reports.filter((x) => x.run.role === 'developer');
  const first = dev.find((x) => x.run.kind === 'feature' || x.run.kind === 'followup') ?? dev[0];
  const lastDev = dev[dev.length - 1];
  const plan = [...reports].reverse().find((x) => x.run.role === 'planner' && x.report.self.plan);
  const tester = [...reports].reverse().find((x) => x.run.role === 'tester');
  const review = [...reports].reverse().find((x) => x.run.role === 'reviewer' && x.report.self.review);
  const validation = [...runs].reverse().find((r) => r.role === 'validator' && r.validation);

  const out: string[] = [];
  out.push('## Summary');
  out.push(first?.report.self.summary || feature.title);
  if (first?.report.self.implementationDetails) out.push('', first.report.self.implementationDetails.slice(0, 4000));
  if (feature.description.trim()) {
    out.push('', '<details><summary>Requirements</summary>', '', feature.description.trim().slice(0, 6000), '', '</details>');
  }
  if (plan) out.push('', '<details><summary>Implementation plan</summary>', '', plan.report.self.plan.slice(0, 8000), '', '</details>');

  if (validation?.validation?.length) {
    out.push('', '## Validation');
    for (const v of validation.validation) out.push(`- ${v.exitCode === 0 && !v.timedOut ? '✅' : '❌'} \`${v.command}\``);
  }
  const tests = (tester ?? lastDev)?.report.self.tests;
  if (tests && (tests.executed.length || tests.passed !== null)) {
    out.push('', '## Tests');
    if (tester?.report.self.summary) out.push(tester.report.self.summary);
    out.push(`- Passed: ${tests.passed ?? 'n/a'} · Failed: ${tests.failed ?? 'n/a'}`);
    if (tests.executed.length) out.push(`- Ran: ${tests.executed.map((c) => `\`${c}\``).join(', ')}`);
  }
  if (review?.report.self.review) {
    const r = review.report.self.review;
    out.push('', `## Automated review: ${r.verdict === 'approve' ? 'approved' : 'changes requested'}`);
    if (r.summary) out.push(r.summary);
    if (r.findings.length) out.push(`- ${r.findings.length} finding(s): ${r.findings.map((f) => f.severity).join(', ')}`);
  }
  const docs = [...new Set(reports.flatMap((x) => x.report.self.docsUpdated))];
  if (docs.length) out.push('', '## Documentation updated', ...docs.map((d) => `- \`${d}\``));
  const issues = lastDev?.report.self.outstandingIssues ?? [];
  if (issues.length) out.push('', '## Outstanding issues', ...issues.map((i) => `- ${i}`));
  out.push('', '---', `_Implemented by Claude Code agents via the Local AI Development Orchestrator (project ${project.name}). Review before merging._`);
  return out.join('\n');
}

/**
 * Push the feature branch and open (or reuse) a GitHub pull request. Never merges.
 * When the feature is stacked on an unmerged dependency, the PR targets that dependency's branch.
 */
export async function createPrForFeature(featureId: string): Promise<Feature> {
  if (!getToken()) throw new HttpError(400, 'No GitHub token configured. Add one in Settings → GitHub.');
  const feature = getFeature(featureId);
  if (feature.agentStatus && ACTIVE_AGENT_STATUSES.includes(feature.agentStatus)) {
    throw new HttpError(409, 'Wait for the agent to finish before creating a pull request');
  }
  if (!feature.branch || !feature.worktreePath || !fs.existsSync(feature.worktreePath)) {
    throw new HttpError(409, 'This feature has no branch/worktree to create a pull request from');
  }
  const project = getProject(feature.projectId);
  const remote = project.pipeline.remote || 'origin';
  try {
    const url = await remoteUrl(project.path, remote);
    const repo = parseRemote(url);
    if (!repo) throw new HttpError(400, `Remote "${remote}" (${url}) is not a GitHub repository URL`);
    const base = feature.baseRef || project.baseBranch;
    const runId = feature.currentRunId;
    const log = (msg: string) => runId && addEvent(runId, 'lifecycle', msg);
    if (base !== project.baseBranch && !(await remoteHasBranch(project.path, remote, base))) {
      log(`Pushing dependency branch ${base} (the pull request targets it because this feature is stacked on it)`);
      await pushBranch(project.path, remote, base);
    }
    log(`Pushing ${feature.branch} to ${remote}`);
    await pushBranch(feature.worktreePath, remote, feature.branch);
    let pr = await findOpenPr(repo, feature.branch);
    if (!pr) {
      const req = { head: feature.branch, base, title: feature.title, body: buildPrBody(feature, project), draft: project.pipeline.prDraft };
      try {
        pr = await createPullRequest(repo, req);
      } catch (err) {
        // Draft PRs aren't available on every plan; fall back to a regular PR.
        if (err instanceof GithubError && err.status === 422 && /draft/i.test(err.message) && req.draft) pr = await createPullRequest(repo, { ...req, draft: false });
        else throw err;
      }
      log(`Pull request #${pr.number} created: ${pr.html_url}`);
    } else {
      log(`Pull request #${pr.number} already open; branch updated: ${pr.html_url}`);
    }
    const updated = patchFeatureState(feature.id, { prUrl: pr.html_url, prNumber: pr.number });
    notify({ title: `Pull request #${pr.number} ready`, body: feature.title, level: 'success', featureId: feature.id, projectId: feature.projectId });
    return updated;
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    if (err instanceof GithubError) throw new HttpError(err.status === 401 || err.status === 400 ? 400 : 502, err.message);
    throw new HttpError(502, err.message);
  }
}
