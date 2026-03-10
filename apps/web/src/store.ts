import { Fragment, type ReactNode, createElement, useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderKind,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import {
  resolveProviderForModel,
  resolveModelSlug,
  resolveModelSlugForProvider,
} from "@t3tools/shared/model";
import { create } from "zustand";
import { type ChatMessage, type Project, type Thread } from "./types";

// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  threadsHydrated: boolean;
}

const PERSISTED_STATE_KEY = "t3code:renderer-state:v8";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  threadsHydrated: false,
};
const persistedExpandedProjectCwds = new Set<string>();
let lastPersistedExpandedProjectSignature = "";

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { [key: string]: JsonLike | undefined };

// ── Persist helpers ──────────────────────────────────────────────────

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as { expandedProjectCwds?: string[] };
    persistedExpandedProjectCwds.clear();
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedExpandedProjectCwds.add(cwd);
      }
    }
    lastPersistedExpandedProjectSignature = Array.from(persistedExpandedProjectCwds).join("\n");
    return { ...initialState };
  } catch {
    return initialState;
  }
}

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    const expandedProjectCwds = state.projects
      .filter((project) => project.expanded)
      .map((project) => project.cwd);
    const nextSignature = expandedProjectCwds.join("\n");
    if (lastPersistedExpandedProjectSignature === nextSignature) {
      return;
    }

    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds,
      }),
    );
    lastPersistedExpandedProjectSignature = nextSignature;
    for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
      window.localStorage.removeItem(legacyKey);
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function isJsonLikeEqual(left: JsonLike | undefined, right: JsonLike | undefined): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (left === null || right === null || left === undefined || right === undefined) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!isJsonLikeEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!(key in right)) {
      return false;
    }
    if (!isJsonLikeEqual(left[key], right[key])) {
      return false;
    }
  }
  return true;
}

function toJsonLike(value: unknown): JsonLike | undefined {
  return value as JsonLike | undefined;
}

function reuseArrayIfEqual<T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  areEqual: (left: T, right: T) => boolean,
): T[] {
  if (!previous || previous.length !== next.length) {
    return [...next];
  }

  let changed = false;
  const merged = next.map((item, index) => {
    const existing = previous[index];
    if (existing !== undefined && areEqual(existing, item)) {
      return existing;
    }
    changed = true;
    return item;
  });
  return changed ? merged : (previous as T[]);
}

function areProjectScriptsEqual(left: Project["scripts"], right: Project["scripts"]): boolean {
  return isJsonLikeEqual(toJsonLike(left), toJsonLike(right));
}

function areChatAttachmentsEqual(
  left: ChatMessage["attachments"],
  right: ChatMessage["attachments"],
): boolean {
  return isJsonLikeEqual(toJsonLike(left), toJsonLike(right));
}

function areMessagesEqual(left: ChatMessage, right: ChatMessage): boolean {
  return (
    left.id === right.id &&
    left.role === right.role &&
    left.text === right.text &&
    left.createdAt === right.createdAt &&
    left.completedAt === right.completedAt &&
    left.streaming === right.streaming &&
    areChatAttachmentsEqual(left.attachments, right.attachments)
  );
}

function areProposedPlansEqual(left: Thread["proposedPlans"], right: Thread["proposedPlans"]): boolean {
  return isJsonLikeEqual(toJsonLike(left), toJsonLike(right));
}

function areTurnDiffSummariesEqual(
  left: Thread["turnDiffSummaries"],
  right: Thread["turnDiffSummaries"],
): boolean {
  return isJsonLikeEqual(toJsonLike(left), toJsonLike(right));
}

function areActivitiesEqual(left: Thread["activities"], right: Thread["activities"]): boolean {
  return isJsonLikeEqual(toJsonLike(left), toJsonLike(right));
}

function areProjectsEqual(left: Project, right: Project): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.cwd === right.cwd &&
    left.model === right.model &&
    left.expanded === right.expanded &&
    areProjectScriptsEqual(left.scripts, right.scripts)
  );
}

function areThreadSessionsEqual(left: Thread["session"], right: Thread["session"]): boolean {
  return isJsonLikeEqual(toJsonLike(left), toJsonLike(right));
}

function areThreadsEqual(left: Thread, right: Thread): boolean {
  return (
    left.id === right.id &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.model === right.model &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    areThreadSessionsEqual(left.session, right.session) &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.lastVisitedAt === right.lastVisitedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    isJsonLikeEqual(toJsonLike(left.latestTurn), toJsonLike(right.latestTurn)) &&
    isJsonLikeEqual(toJsonLike(left.messages), toJsonLike(right.messages)) &&
    areProposedPlansEqual(left.proposedPlans, right.proposedPlans) &&
    areTurnDiffSummariesEqual(left.turnDiffSummaries, right.turnDiffSummaries) &&
    areActivitiesEqual(left.activities, right.activities)
  );
}

function reuseProject(previous: Project | undefined, next: Project): Project {
  if (!previous) {
    return next;
  }
  const scripts = reuseArrayIfEqual(previous.scripts, next.scripts, (left, right) =>
    isJsonLikeEqual(toJsonLike(left), toJsonLike(right)),
  );
  const candidate = scripts === next.scripts ? next : { ...next, scripts };
  return areProjectsEqual(previous, candidate) ? previous : candidate;
}

function reuseThread(previous: Thread | undefined, next: Thread): Thread {
  if (!previous) {
    return next;
  }

  const messages = reuseArrayIfEqual(previous.messages, next.messages, areMessagesEqual);
  const proposedPlans = reuseArrayIfEqual(
    previous.proposedPlans,
    next.proposedPlans,
    (left, right) => isJsonLikeEqual(toJsonLike(left), toJsonLike(right)),
  );
  const turnDiffSummaries = reuseArrayIfEqual(
    previous.turnDiffSummaries,
    next.turnDiffSummaries,
    (left, right) => isJsonLikeEqual(toJsonLike(left), toJsonLike(right)),
  );
  const activities = reuseArrayIfEqual(
    previous.activities,
    next.activities,
    (left, right) => isJsonLikeEqual(toJsonLike(left), toJsonLike(right)),
  );
  const candidate =
    messages === next.messages &&
    proposedPlans === next.proposedPlans &&
    turnDiffSummaries === next.turnDiffSummaries &&
    activities === next.activities
      ? next
      : { ...next, activities, messages, proposedPlans, turnDiffSummaries };

  return areThreadsEqual(previous, candidate) ? previous : candidate;
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  return incoming.map((project) => {
    const existing =
      previousById.get(project.id) ??
      previous.find((entry) => entry.cwd === project.workspaceRoot);
    return reuseProject(existing, {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      model:
        existing?.model ??
        resolveModelSlug(project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex),
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectCwds.size > 0
          ? persistedExpandedProjectCwds.has(project.workspaceRoot)
          : true),
      scripts: project.scripts.map((script) => ({ ...script })),
    });
  });
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  if (providerName === "codex" || providerName === "gemini") {
    return providerName;
  }
  return "codex";
}

function inferProviderForThreadModel(input: {
  readonly model: string;
  readonly sessionProviderName: string | null;
}): ProviderKind {
  if (input.sessionProviderName === "codex" || input.sessionProviderName === "gemini") {
    return input.sessionProviderName;
  }
  return resolveProviderForModel(input.model);
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    state.projects,
  );
  const existingThreadById = new Map(state.threads.map((thread) => [thread.id, thread] as const));
  const threads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      return reuseThread(existing, {
        id: thread.id,
        codexThreadId: null,
        projectId: thread.projectId,
        title: thread.title,
        model: resolveModelSlugForProvider(
          inferProviderForThreadModel({
            model: thread.model,
            sessionProviderName: thread.session?.providerName ?? null,
          }),
          thread.model,
        ),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        session: thread.session
          ? {
              provider: toLegacyProvider(thread.session.providerName),
              status: toLegacySessionStatus(thread.session.status),
              orchestrationStatus: thread.session.status,
              activeTurnId: thread.session.activeTurnId ?? undefined,
              createdAt: thread.session.updatedAt,
              updatedAt: thread.session.updatedAt,
              ...(thread.session.lastError ? { lastError: thread.session.lastError } : {}),
            }
          : null,
        messages: thread.messages.map((message) => {
          const attachments = message.attachments?.map((attachment) => ({
            type: "image" as const,
            id: attachment.id,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
          }));
          const normalizedMessage: ChatMessage = {
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
            streaming: message.streaming,
            ...(message.streaming ? {} : { completedAt: message.updatedAt }),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          };
          return normalizedMessage;
        }),
        proposedPlans: thread.proposedPlans.map((proposedPlan) => ({
          id: proposedPlan.id,
          turnId: proposedPlan.turnId,
          planMarkdown: proposedPlan.planMarkdown,
          createdAt: proposedPlan.createdAt,
          updatedAt: proposedPlan.updatedAt,
        })),
        error: thread.session?.lastError ?? null,
        createdAt: thread.createdAt,
        latestTurn: thread.latestTurn,
        lastVisitedAt: existing?.lastVisitedAt ?? thread.updatedAt,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        turnDiffSummaries: thread.checkpoints.map((checkpoint) => ({
          turnId: checkpoint.turnId,
          completedAt: checkpoint.completedAt,
          status: checkpoint.status,
          assistantMessageId: checkpoint.assistantMessageId ?? undefined,
          checkpointTurnCount: checkpoint.checkpointTurnCount,
          checkpointRef: checkpoint.checkpointRef,
          files: checkpoint.files.map((file) => ({ ...file })),
        })),
        activities: thread.activities.map((activity) => ({ ...activity })),
      });
    });
  const projectsChanged =
    projects.length !== state.projects.length ||
    projects.some((project, index) => project !== state.projects[index]);
  const threadsChanged =
    threads.length !== state.threads.length ||
    threads.some((thread, index) => thread !== state.threads[index]);
  const threadsHydratedChanged = !state.threadsHydrated;
  if (!projectsChanged && !threadsChanged && !threadsHydratedChanged) {
    return state;
  }
  return {
    ...state,
    ...(projectsChanged ? { projects } : {}),
    ...(threadsChanged ? { threads } : {}),
    threadsHydrated: true,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(state.threads, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
}));

useStore.subscribe((state, previousState) => {
  if (state.projects === previousState.projects) {
    return;
  }
  persistState(state);
});

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
