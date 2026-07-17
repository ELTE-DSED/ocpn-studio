import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const listRef = React.useRef<HTMLDivElement>(null);
  // Position/size of the sliding active-tab indicator, in pixels relative to the list.
  // null until the first measurement lands, so the indicator doesn't flash at the
  // top-left corner before it knows where the active tab actually is.
  const [indicator, setIndicator] = React.useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const measure = React.useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]');
    if (!active) return;
    // Measured directly from the trigger's own box (not hardcoded inset classes) so the
    // pill exactly matches the trigger's real rendered bounds — a fixed top/bottom inset
    // here previously didn't line up with the trigger's actual height, leaving a sliver
    // of visible gap above/below the pill even after the left/width was fixed.
    const next = { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
    // Bail out on unchanged values — a fresh object every measurement would otherwise
    // never satisfy React's reference-equality bailout, causing a render loop (the
    // layout effect below intentionally has no dependency array, since it needs to
    // re-measure after every render, not just when `indicator` itself changes).
    setIndicator((prev) => (
      prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height
        ? prev
        : next
    ));
  }, []);

  // Re-measure whenever the active tab (or the list's own children/layout) changes.
  React.useLayoutEffect(() => {
    measure();
  });

  // Also re-measure on resize (e.g. sidebar width drag), since offsets shift without
  // the active tab itself changing.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      className={cn(
        "bg-muted/40 text-muted-foreground relative inline-flex h-9 w-fit items-center justify-center rounded-lg border border-border/70",
        className
      )}
      {...props}
    >
      {/* Sliding active-tab background — a single element that animates position and
          width, instead of each trigger flipping its own background on/off. This is
          what makes the highlight glide between tabs (Affinity-style) and keeps the
          background transition in lockstep with the text color transition below, so
          neither one visibly lags and flickers behind the other. */}
      {indicator && (
        <div
          className="bg-primary absolute rounded-md shadow-sm transition-[left,width] duration-200 ease-out"
          style={{ left: indicator.left, top: indicator.top, width: indicator.width, height: indicator.height }}
          aria-hidden="true"
        />
      )}
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Text color intentionally has NO transition: animating it would interpolate
        // between two achromatic OKLCH colors (foreground/primary-foreground both have
        // chroma 0, so hue is undefined), which some browsers resolve by sweeping
        // through an arbitrary hue mid-transition — visible as a brief colored flash.
        // Snapping it instantly avoids that; only the sliding pill background animates.
        "data-[state=active]:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring text-foreground dark:text-muted-foreground relative z-10 inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
