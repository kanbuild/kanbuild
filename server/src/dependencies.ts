/** Pure helpers for the feature dependency graph. */

export type DepGraph = Map<string, string[]>;

/** Would making `featureId` depend on each of `dependsOn` create a cycle (given the rest of the graph)? Returns the cycle path. */
export function findCycle(graph: DepGraph, featureId: string, dependsOn: string[]): string[] | null {
  const g: DepGraph = new Map(graph);
  g.set(featureId, dependsOn);
  // DFS from each new dependency looking for featureId.
  for (const start of dependsOn) {
    const stack: { id: string; path: string[] }[] = [{ id: start, path: [featureId, start] }];
    const seen = new Set<string>();
    while (stack.length) {
      const { id, path } = stack.pop()!;
      if (id === featureId) return path;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of g.get(id) ?? []) stack.push({ id: next, path: [...path, next] });
    }
  }
  return null;
}

/**
 * Pick the ref a dependent feature's branch should start from.
 * - all dependencies merged into the base branch (or none) → base branch
 * - exactly one unmerged dependency → stack on that dependency's branch
 * - several unmerged → cannot stack; the caller reports which ones to merge
 */
export function chooseBaseRef(
  baseBranch: string,
  deps: { title: string; branch: string | null; merged: boolean }[],
): { ref: string; stackedOn: string | null } | { error: string } {
  const unmerged = deps.filter((d) => d.branch && !d.merged);
  if (unmerged.length === 0) return { ref: baseBranch, stackedOn: null };
  if (unmerged.length === 1) return { ref: unmerged[0].branch!, stackedOn: unmerged[0].title };
  return {
    error: `Cannot stack on several unmerged dependencies (${unmerged.map((d) => `"${d.title}"`).join(', ')}). Merge all but one of them into ${baseBranch}, then retry.`,
  };
}
