import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { startTransition, useEffect } from "react";

import { isElectron } from "../env";
import { APP_STAGE_LABEL } from "../branding";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import ThreadSidebar from "../components/Sidebar";
import { Sidebar, SidebarProvider, useSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

function SidebarKeyboardShortcut() {
  const { toggleSidebar } = useSidebar();
  const navigate = useNavigate();

  useEffect(() => {
    let altDown = false;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "b" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        toggleSidebar();
      }
      // Track if Alt was pressed alone (no combos)
      if (event.key === "Alt") {
        altDown = true;
      } else {
        altDown = false;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      // Toggle settings on clean Alt release (no other key was pressed)
      if (event.key === "Alt" && altDown) {
        altDown = false;
        const isOnSettings =
          window.location.hash.includes("/settings") ||
          window.location.pathname.includes("/settings");
        if (isOnSettings) {
          window.history.back();
        } else {
          startTransition(() => {
            void navigate({ to: "/settings" });
          });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toggleSidebar, navigate]);

  return null;
}

function ChatLayoutContent() {
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed";
  
  return (
    <div 
      className={cn(
        "chat-layout-shell flex min-h-0 min-w-0 flex-1 flex-col bg-card",
        !isCollapsed && !isMobile ? "pl-2" : "pl-0"
      )}
      data-sidebar-collapsed={isCollapsed || isMobile ? "true" : "false"}
    >
      {isElectron ? (
        <div className="drag-region flex h-[36px] shrink-0 w-full items-center">
          {isCollapsed && (
            <div className="flex items-center gap-1.5 pl-3 [-webkit-app-region:no-drag]">
              <span className="text-[18px] font-bold leading-none tracking-tighter text-foreground">T3</span>
              <span className="text-sm font-medium tracking-tight text-muted-foreground">Code</span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="h-2 shrink-0 w-full" />
      )}
      <DiffWorkerPoolProvider>
        <Outlet />
      </DiffWorkerPoolProvider>
    </div>
  );
}

function ChatRouteLayout() {
  const navigate = useNavigate();

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      startTransition(() => {
        void navigate({ to: "/settings" });
      });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen className="h-svh overflow-hidden">
      <SidebarKeyboardShortcut />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="bg-card text-foreground"
      >
        <ThreadSidebar />
      </Sidebar>
      <ChatLayoutContent />
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  component: ChatRouteLayout,
});
