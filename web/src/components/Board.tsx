import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Bot, CheckCheck, Inbox, Plus } from 'lucide-react';
import type { Feature, FeatureStatus } from '@shared/types.ts';
import { api } from '@/api';
import { getState, upsertFeature, useStore } from '@/store';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { FeatureComposer } from './FeatureComposer';
import { FeatureCardView, SortableFeatureCard } from './FeatureCard';
import { confirm } from './confirm';
import { toast, toastError } from './toast';
import { isActive, isReadyToStart } from './status';

const COLUMNS: { id: FeatureStatus; title: string; icon: React.ElementType; hint: string }[] = [
  { id: 'backlog', title: 'Backlog', icon: Inbox, hint: 'Drag a card into Build to start an agent' },
  { id: 'build', title: 'Build', icon: Bot, hint: 'Agents working in isolated worktrees' },
  { id: 'done', title: 'Done', icon: CheckCheck, hint: 'Completed features ready for review' },
];

type ColumnsState = Record<FeatureStatus, string[]>;

const COLUMN_IDS = new Set<string>(COLUMNS.map((c) => c.id));

/**
 * The column under the pointer wins. A card under the pointer refines the position within that column.
 * (Plain closestCorners compares the corners of tall columns with those of small cards, so a drop in the
 * upper part of Build could resolve to a card in Done.)
 */
const columnFirstCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const candidates = hits.length ? hits : rectIntersection(args);
  const column = candidates.find((h) => COLUMN_IDS.has(String(h.id)));
  if (!column) return candidates.length ? candidates : closestCorners(args);
  const cards = candidates.filter((h) => !COLUMN_IDS.has(String(h.id)));
  return cards.length ? [...cards, column] : [column];
};

function buildColumns(features: Feature[]): ColumnsState {
  const cols: ColumnsState = { backlog: [], build: [], done: [] };
  for (const f of [...features].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))) {
    cols[f.status].push(f.id);
  }
  return cols;
}

function findColumn(cols: ColumnsState, id: string): FeatureStatus | null {
  if (id in cols) return id as FeatureStatus;
  for (const k of Object.keys(cols) as FeatureStatus[]) if (cols[k].includes(id)) return k;
  return null;
}

function Column({
  id,
  title,
  icon: Icon,
  hint,
  ids,
  features,
  onOpen,
  onAdd,
  stats,
  composer,
}: {
  id: FeatureStatus;
  title: string;
  icon: React.ElementType;
  hint: string;
  ids: string[];
  features: Record<string, Feature>;
  onOpen: (f: Feature) => void;
  onAdd?: () => void;
  stats?: React.ReactNode;
  composer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn('metal-glass flex min-h-0 w-full min-w-[280px] flex-1 flex-col rounded-2xl transition-shadow', isOver && 'shadow-glow')}
    >
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3">
        <div className="flex items-center gap-2">
          <span className="metal-raised flex h-6 w-6 items-center justify-center rounded-lg">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <span className="metal-inset rounded-full px-2 text-[11px] tabular-nums text-muted-foreground">{ids.length}</span>
        </div>
        {onAdd && (
          <Button size="icon-round" variant="secondary" className="h-7 w-7" onClick={onAdd} title="New feature">
            <Plus />
          </Button>
        )}
      </div>
      <p className="px-3 pb-2 text-[11px] text-muted-foreground">{stats ?? hint}</p>
      {composer && <div className="px-2 pb-2">{composer}</div>}
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3 pt-1">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((fid) => features[fid] && <SortableFeatureCard key={fid} feature={features[fid]} onOpen={onOpen} />)}
        </SortableContext>
        {ids.length === 0 && (
          <div className="rounded-xl border border-dashed border-foreground/15 p-6 text-center text-xs text-muted-foreground">
            {id === 'backlog' ? 'No features yet' : id === 'build' ? 'Drop a feature here to start an agent' : 'Nothing finished yet'}
          </div>
        )}
      </div>
    </div>
  );
}

export function Board({ projectId, onOpen, onAdd }: { projectId: string; onOpen: (f: Feature) => void; onAdd: () => void }) {
  const allFeatures = useStore((s) => s.features);
  const concurrency = useStore((s) => s.settings?.concurrency ?? 2);
  // Primitives only, so the selectors stay stable.
  const projectAutoStart = useStore((s) => s.projects.find((p) => p.id === projectId)?.pipeline.autoStart ?? null);
  const globalAutoStart = useStore((s) => s.settings?.autoStartBuild ?? true);
  const autoStart = projectAutoStart ?? globalAutoStart;
  const features = useMemo(() => {
    const out: Record<string, Feature> = {};
    for (const f of Object.values(allFeatures)) if (f.projectId === projectId) out[f.id] = f;
    return out;
  }, [allFeatures, projectId]);

  const serverCols = useMemo(() => buildColumns(Object.values(features)), [features]);
  const [cols, setCols] = useState<ColumnsState>(serverCols);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<FeatureStatus | null>(null);

  useEffect(() => {
    if (!activeId) setCols(serverCols);
  }, [serverCols, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setOrigin(findColumn(cols, String(e.active.id)));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findColumn(cols, String(active.id));
    const to = findColumn(cols, String(over.id));
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const fromItems = prev[from].filter((x) => x !== active.id);
      const toItems = [...prev[to]];
      const overIndex = toItems.indexOf(String(over.id));
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, String(active.id));
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  };

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const startCol = origin;
    setActiveId(null);
    setOrigin(null);
    if (!over || !startCol) {
      setCols(serverCols);
      return;
    }
    const col = findColumn(cols, id)!;
    let nextIds = cols[col];
    const overIdx = nextIds.indexOf(String(over.id));
    const curIdx = nextIds.indexOf(id);
    if (overIdx >= 0 && curIdx !== overIdx) nextIds = arrayMove(nextIds, curIdx, overIdx);
    const finalCols = { ...cols, [col]: nextIds };
    setCols(finalCols);
    const feature = getState().features[id];

    try {
      if (col !== startCol) {
        let confirmCancel = false;
        if (startCol === 'build' && isActive(feature.agentStatus)) {
          confirmCancel = await confirm({
            title: 'Cancel the running agent?',
            description: `An agent is working on "${feature.title}". Moving it out of Build cancels the agent. Its worktree and branch are kept.`,
            confirmLabel: 'Cancel agent & move',
            destructive: true,
          });
          if (!confirmCancel) return setCols(serverCols);
        }
        if (col === 'build' && startCol === 'done' && autoStart) {
          const ok = await confirm({
            title: 'Start a new agent run?',
            description: `"${feature.title}" will be developed again in its existing worktree (${feature.branch ?? 'new branch'}).`,
            confirmLabel: 'Start agent',
          });
          if (!ok) return setCols(serverCols);
        }
        const updated = await api.updateFeature(id, { status: col, confirmCancel });
        upsertFeature(updated);
        if (col === 'build' && updated.agentStatus === 'queued') toast(`Agent queued for "${feature.title}"`);
      }
      await api.reorder(projectId, col, nextIds);
    } catch (err) {
      toastError(err);
      setCols(serverCols);
    }
  };

  const running = Object.values(features).filter((f) => f.agentStatus === 'running' || f.agentStatus === 'initialising').length;
  const queued = Object.values(features).filter((f) => f.agentStatus === 'queued').length;
  const ready = Object.values(features).filter(isReadyToStart).length;
  const buildStats = [running || queued ? `${running} running · ${queued} queued · limit ${concurrency} concurrent (global)` : '', ready ? `${ready} ready to start` : '']
    .filter(Boolean)
    .join(' · ');
  const activeFeature = activeId ? features[activeId] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={columnFirstCollision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setCols(serverCols);
      }}
    >
      <div className="flex h-full min-h-0 gap-3 overflow-x-auto p-4">
        {COLUMNS.map((c) => (
          <Column
            key={c.id}
            {...c}
            ids={cols[c.id]}
            features={features}
            onOpen={onOpen}
            onAdd={c.id === 'backlog' ? onAdd : undefined}
            hint={
              autoStart
                ? c.hint
                : c.id === 'backlog'
                  ? 'Drag a card into Build, then press ▶ to start its agent'
                  : c.id === 'build'
                    ? 'Press ▶ on a card to start its agent'
                    : c.hint
            }
            stats={c.id === 'build' && buildStats ? buildStats : undefined}
            composer={c.id === 'backlog' ? <FeatureComposer projectId={projectId} onMore={onAdd} /> : undefined}
          />
        ))}
      </div>
      <DragOverlay>{activeFeature ? <FeatureCardView feature={activeFeature} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}
