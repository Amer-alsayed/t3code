import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, startTransition, useCallback, useEffect, useRef, useState } from "react";

import ChatView from "../components/ChatView";
import { useComposerDraftStore } from "../composerDraftStore";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useStore } from "../store";
import { SidebarInset } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";
import { isElectron } from "../env";

const DiffPanel = lazy(() => import("../components/DiffPanel"));

const DIFF_MIN_PERCENT = 15;
const DIFF_MAX_PERCENT = 38;
const DIFF_DEFAULT_PERCENT = 38;
const DIFF_MIN_PX = 180;

const DiffLoadingFallback = (props: { inline: boolean }) => {
  const electronHeader = isElectron ? (
    <div className="drag-region h-[36px] w-full shrink-0 border-b border-border" />
  ) : null;

  if (props.inline) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
        {electronHeader}
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
          Loading diff viewer...
        </div>
      </div>
    );
  }

  return (
    <aside className="flex min-h-0 flex-1 w-[560px] shrink-0 flex-col overflow-hidden border-l border-border bg-card">
      {electronHeader}
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground/70">
        Loading diff viewer...
      </div>
    </aside>
  );
};

const DiffPanelInline = (props: { diffOpen: boolean }) => {
  const [widthPercent, setWidthPercent] = useState(DIFF_DEFAULT_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    setIsDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isDragging || !containerRef.current) return;
      const parent = containerRef.current.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const offsetFromRight = parentRect.right - event.clientX;
      const rawPercent = Math.round((offsetFromRight / parentRect.width) * 100);
      // Enforce pixel-based minimum: ensure the width never goes below DIFF_MIN_PX
      const minPercentFromPx = Math.ceil((DIFF_MIN_PX / parentRect.width) * 100);
      const effectiveMin = Math.max(DIFF_MIN_PERCENT, minPercentFromPx);
      setWidthPercent(Math.max(effectiveMin, Math.min(DIFF_MAX_PERCENT, rawPercent)));
    },
    [isDragging],
  );

  const onPointerUp = useCallback(() => {
    setIsDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  // Auto-adapt: when the window resizes, ensure the diff panel never goes below DIFF_MIN_PX
  useEffect(() => {
    const container = containerRef.current;
    const parent = container?.parentElement;
    if (!parent || !props.diffOpen) return;

    const observer = new ResizeObserver(() => {
      const parentWidth = parent.getBoundingClientRect().width;
      if (parentWidth <= 0) return;
      const minPercentFromPx = Math.ceil((DIFF_MIN_PX / parentWidth) * 100);
      const effectiveMin = Math.max(DIFF_MIN_PERCENT, minPercentFromPx);
      setWidthPercent((current) => Math.max(effectiveMin, Math.min(DIFF_MAX_PERCENT, current)));
    });

    observer.observe(parent);
    return () => observer.disconnect();
  }, [props.diffOpen]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative shrink-0 overflow-hidden border-border bg-transparent will-change-[width]",
        props.diffOpen ? "min-w-0 border-l" : "w-0",
        !isDragging && "transition-[width] duration-200 ease-out",
      )}
      style={{ width: props.diffOpen ? `${widthPercent}%` : 0 }}
    >
      {/* Resize handle */}
      <div
        className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/40 transition-colors duration-150"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="h-full min-w-[180px]">
        <Suspense fallback={<DiffLoadingFallback inline />}>
          <DiffPanel mode="sidebar" />
        </Suspense>
      </div>
    </div>
  );
};

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThread = useComposerDraftStore((store) => store.draftThreadsByThreadId[threadId] ?? null);
  const draftThreadProjectExists = useStore((store) =>
    draftThread === null ? false : store.projects.some((project) => project.id === draftThread.projectId),
  );
  const routeThreadExists = threadExists || (draftThread !== null && draftThreadProjectExists);
  const diffOpen = search.diff === "1";
  const closeDiff = useCallback(() => {
    startTransition(() => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          return stripDiffSearchParams(previous);
        },
      });
    });
  }, [navigate, threadId]);
  const openDiff = useCallback(() => {
    startTransition(() => {
      void navigate({
        to: "/$threadId",
        params: { threadId },
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return { ...rest, diff: "1" };
        },
      });
    });
  }, [navigate, threadId]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      startTransition(() => {
        void navigate({ to: "/", replace: true });
      });
      return;
    }
  }, [navigate, routeThreadExists, threadsHydrated, threadId]);

  if (!threadsHydrated || !routeThreadExists) {
    return null;
  }

  return (
    <div className="content-panel flex h-full min-h-0 min-w-0 flex-1 bg-background text-foreground">
      <SidebarInset className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden overscroll-y-none bg-transparent">
        <ChatView threadId={threadId} />
      </SidebarInset>
      <DiffPanelInline diffOpen={diffOpen} />
    </div>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  component: ChatThreadRouteView,
});
