import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Search, Trash, ArrowRightLeft, Database, Filter, LayoutGrid, Box, Tag, List, ArrowDownAZ } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import useStore from "@/stores/store"
import { useCountUp } from "@/hooks/useCountUp"
import { formatDateTimeFull } from "@/utils/timeFormat"

export interface SimulationEvent {
  id: string
  step: number
  time: number
  transitionId: string
  transitionName: string
  tokens: {
    consumed: { placeId: string; placeName: string; tokens: string }[]
    produced: { placeId: string; placeName: string; tokens: string }[]
  }
  timestamp: Date
}

export interface TransitionFilterItem {
  id: string
  name: string
  /** Connected to an object place — the structural reason to treat a firing as an event. */
  involvesRecordType: boolean
  /** Effective OCEL export setting: the transition's own flag, or the structural default. */
  includeInOcel: boolean
  /** The modeller turned this one off explicitly, rather than it just lacking object places. */
  excludedByModel: boolean
}

/** Summary counts for the log, matching what an OCEL export of it would contain. */
export interface EventLogStats {
  objectTypes: number
  objects: number
  eventTypes: number
  events: number
}

/**
 * Per-event figures derived from the OCEL conversion, keyed by OCEL event id (`e<step>`).
 * Computed by the panel because only it holds the colorsets and arcs the conversion needs
 * — and computing them there means a row shows exactly what an export would.
 */
export interface EventOcelSummary {
  /** Object relationships (e2o) this event carries. */
  objects: number
  /** Distinct object types among them. */
  objectTypes: number
}

/** Tokens this event moved, and the places it touched. */
interface TokenCounts {
  consumed: number
  produced: number
  places: number
}

/** How many event rows the list renders at most, newest last. */
const MAX_RENDERED_EVENTS = 300

// Events are immutable once logged, so their token counts are worth parsing once. A
// WeakMap keeps that cache tied to the event's lifetime: clearing the log drops the
// entries with it, and an unvirtualized list of a few thousand rows doesn't re-parse
// every token string on every render.
const tokenCountCache = new WeakMap<SimulationEvent, TokenCounts>()

function countTokens(event: SimulationEvent): TokenCounts {
  const cached = tokenCountCache.get(event)
  if (cached) return cached

  // Movement token lists are JSON arrays (the same text the OCEL export parses); a
  // movement whose tokens aren't parseable still counts as touching its place.
  const sum = (movements: { tokens: string }[]) =>
    movements.reduce((total, m) => {
      try {
        const parsed = JSON.parse(m.tokens)
        return total + (Array.isArray(parsed) ? parsed.length : 1)
      } catch {
        return total
      }
    }, 0)

  const counts: TokenCounts = {
    consumed: sum(event.tokens.consumed),
    produced: sum(event.tokens.produced),
    places: new Set([
      ...event.tokens.consumed.map(m => m.placeId),
      ...event.tokens.produced.map(m => m.placeId),
    ]).size,
  }
  tokenCountCache.set(event, counts)
  return counts
}

/**
 * Compact figures: 1284 → "1,284", 12900 → "12.9K". Keeps the tile readable when a
 * long run pushes the event count into five or six digits.
 */
function formatCount(value: number): string {
  if (value < 10_000) return value.toLocaleString()
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`
  return `${(value / 1_000_000).toFixed(1)}M`
}

/**
 * Deliberately flat. The simulation panel stacks status, enabled transitions and the
 * log in one column, so every pixel here is taken from the event list below — an
 * icon-above-value tile (the usual dashboard shape) pushed the search field clean off
 * the panel. Icon sits beside the value; the label gets the full tile width so
 * "Object Types" still fits on one line at four columns.
 */
function StatTile({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  // These figures are recomputed only when a run ends, so they arrive as one jump of
  // thousands. Rolling the digits shows that as movement rather than a blink.
  const shown = useCountUp(value)
  return (
    <div className="rounded-md border bg-muted/40 px-2 py-1.5" title={`${value.toLocaleString()} ${label}`}>
      <div className="flex items-center gap-1">
        <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {/* Tabular figures while the count rolls, so the digits change in place instead of
            the tile jittering on every frame; the title carries the exact settled value. */}
        <span className="text-base font-semibold leading-none text-foreground tabular-nums">{formatCount(shown)}</span>
      </div>
      {/* Wraps rather than truncates: at four columns "Object Types" does not fit on
          one line, and "Object Ty…" is worse than two short lines. */}
      <div className="mt-1 text-[10px] leading-tight text-muted-foreground">{label}</div>
    </div>
  )
}

interface EventLogProps {
  events: SimulationEvent[]
  onClearLog: () => void
  onExport?: () => void
  canExport?: boolean
  exportDisabledReason?: string
  transitions?: TransitionFilterItem[]
  filteredTransitionIds?: Set<string>
  onFilterChange?: (ids: Set<string>) => void
  subpageNote?: string
  stats?: EventLogStats
  eventSummaries?: Map<string, EventOcelSummary>
}

export function EventLog({ events, onClearLog, onExport, canExport, exportDisabledReason, transitions, filteredTransitionIds, onFilterChange, subpageNote, stats, eventSummaries }: EventLogProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set())
  const [filterDialogOpen, setFilterDialogOpen] = useState(false)
  const [tempFilterIds, setTempFilterIds] = useState<Set<string>>(new Set())
  // Off by default so the list keeps model order — which groups a subpage's transitions
  // together and roughly follows the flow. Alphabetical is for finding one by name in a
  // long list, so it is a toggle rather than the only order on offer.
  const [sortAlphabetically, setSortAlphabetically] = useState(false)
  const simulationEpoch = useStore((state) => state.simulationEpoch)
  const epoch = simulationEpoch ? new Date(simulationEpoch) : null

  const toggleEventExpanded = (eventId: string) => {
    const newExpanded = new Set(expandedEvents)
    if (newExpanded.has(eventId)) {
      newExpanded.delete(eventId)
    } else {
      newExpanded.add(eventId)
    }
    setExpandedEvents(newExpanded)
  }

  const handleOpenFilterDialog = () => {
    setTempFilterIds(new Set(filteredTransitionIds ?? []))
    setFilterDialogOpen(true)
  }

  const handleSaveFilter = () => {
    onFilterChange?.(tempFilterIds)
    setFilterDialogOpen(false)
  }

  const toggleTempFilter = (id: string, checked: boolean) => {
    const next = new Set(tempFilterIds)
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
    setTempFilterIds(next)
  }

  const selectAll = () => {
    if (transitions) {
      setTempFilterIds(new Set(transitions.map(t => t.id)))
    }
  }

  const selectNone = () => {
    setTempFilterIds(new Set())
  }

  /** Back to what the model says: the per-transition OCEL export setting. */
  const selectModelDefault = () => {
    if (transitions) {
      setTempFilterIds(new Set(transitions.filter(t => t.includeInOcel).map(t => t.id)))
    }
  }

  const listedTransitions = useMemo(() => {
    if (!transitions) return []
    if (!sortAlphabetically) return transitions
    // Locale-aware and case-insensitive: "Ship order" belongs next to "ship item", not in
    // a separate uppercase block. Newlines in a label are layout, not content.
    const flatten = (name: string) => name.replace(/\n/g, ' ')
    return [...transitions].sort((a, b) =>
      flatten(a.name).localeCompare(flatten(b.name), undefined, { sensitivity: 'base' })
    )
  }, [transitions, sortAlphabetically])

  /** Whether the pending selection differs from what the model itself specifies. */
  const filterDivergesFromModel = useMemo(() => {
    if (!transitions) return false
    return transitions.some(t => t.includeInOcel !== tempFilterIds.has(t.id))
  }, [transitions, tempFilterIds])

  // Apply transition filter, then text search
  const visibleEvents = useMemo(() => {
    let result = events
    if (filteredTransitionIds && filteredTransitionIds.size > 0) {
      result = result.filter(e => filteredTransitionIds.has(e.transitionId))
    } else if (filteredTransitionIds && filteredTransitionIds.size === 0) {
      result = [] // explicit empty selection means show nothing
    }
    if (searchTerm) {
      result = result.filter(
        (event) =>
          event.transitionName.replace(/\n/g, ' ').toLowerCase().includes(searchTerm.toLowerCase()) ||
          event.tokens.consumed.some((t) => t.placeName.replace(/\n/g, ' ').toLowerCase().includes(searchTerm.toLowerCase())) ||
          event.tokens.produced.some((t) => t.placeName.replace(/\n/g, ' ').toLowerCase().includes(searchTerm.toLowerCase())),
      )
    }
    return result
  }, [events, filteredTransitionIds, searchTerm])

  // The list is not virtualized, so every row it holds is re-rendered whenever the log
  // grows — which during a run is several times a second. Rendering thousands of rows
  // that way costs more with every batch and is what makes a long run crawl. Only the
  // most recent slice is rendered; the count above and the export always cover the whole
  // log, and search/filter run over all of it before this cut.
  const renderedEvents = useMemo(
    () => (visibleEvents.length > MAX_RENDERED_EVENTS ? visibleEvents.slice(-MAX_RENDERED_EVENTS) : visibleEvents),
    [visibleEvents]
  )
  const hiddenEventCount = visibleEvents.length - renderedEvents.length

  const isFilterActive = transitions && filteredTransitionIds && filteredTransitionIds.size < transitions.length

  // Simulation time for a row: an absolute datetime when an epoch is set, otherwise the
  // plain model time. Split into clock and date so the row can lead with the part that
  // differs between neighbouring events and demote the rest; `full` goes in the tooltip,
  // where the timezone offset is worth having and per-row repetition costs nothing.
  const formatSimTime = (timeMs: number): { clock: string; date?: string; full: string } => {
    if (!epoch) {
      return { clock: `${timeMs.toLocaleString()} ms`, full: `Model time ${timeMs} ms` }
    }
    const absoluteDate = new Date(epoch.getTime() + timeMs)
    const pad = (n: number, len = 2) => String(n).padStart(len, '0')
    return {
      clock: `${pad(absoluteDate.getHours())}:${pad(absoluteDate.getMinutes())}:${pad(absoluteDate.getSeconds())}.${pad(absoluteDate.getMilliseconds(), 3)}`,
      date: `${absoluteDate.getFullYear()}-${pad(absoluteDate.getMonth() + 1)}-${pad(absoluteDate.getDate())}`,
      full: formatDateTimeFull(absoluteDate),
    }
  }

  return (
    <Card className="w-full h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold leading-none tracking-tight">Event Log</span>
          <div className="flex items-center space-x-1">
            {transitions && transitions.length > 0 && (
              <Button
                variant="outline"
                size="icon"
                onClick={handleOpenFilterDialog}
                title="Filter Transitions"
                className={isFilterActive ? "border-primary text-primary" : ""}
              >
                <Filter className="h-4 w-4" />
              </Button>
            )}
            <Button variant="outline" size="icon" onClick={onClearLog} title="Clear Log">
              <Trash className="h-4 w-4" />
            </Button>
            {onExport && (
              <Button
                variant="outline"
                onClick={onExport}
                disabled={!canExport}
                title={exportDisabledReason || "Export as OCEL 2.0"}
                className="flex items-center gap-1 h-9 px-3"
              >
                <Database className="h-4 w-4" />
                Export OCEL
              </Button>
            )}
          </div>
        </div>
        {/* The simulation panel is user-resizable, so the row adapts to its own width
            rather than the viewport: 2×2 when narrow, a single row of four once there
            is room for the longest label ("Object Types") without wrapping. */}
        {stats && (
          <div className="@container">
            {/* @2xs (18rem) not @xs (20rem): the card's own padding leaves ~317px at the
                panel's default width, just under 20rem, which would keep it at 2×2. */}
            <div className="grid grid-cols-2 @2xs:grid-cols-4 gap-1.5">
              <StatTile icon={LayoutGrid} value={stats.objectTypes} label="Object Types" />
              <StatTile icon={Box} value={stats.objects} label="Objects" />
              <StatTile icon={Tag} value={stats.eventTypes} label="Event Types" />
              <StatTile icon={List} value={stats.events} label="Events" />
            </div>
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search events..."
            className="pl-8"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </CardHeader>
      {subpageNote && (
        <div className="mx-4 mb-2 px-3 py-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md border border-border">
          {subpageNote}
        </div>
      )}
      <CardContent className="flex-1 overflow-hidden min-h-0">
        <ScrollArea className="h-full">
          {visibleEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {events.length === 0 ? "No events recorded yet" : "No events match your filter or search"}
            </div>
          ) : (
            <div className="space-y-2">
              {hiddenEventCount > 0 && (
                <p className="rounded-md border border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                  {hiddenEventCount.toLocaleString()} earlier {hiddenEventCount === 1 ? 'event is' : 'events are'} not shown.
                  All {visibleEvents.length.toLocaleString()} are counted above and included in the export.
                </p>
              )}
              {renderedEvents.map((event) => (
                <div
                  key={event.id}
                  className="border rounded-md p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleEventExpanded(event.id)}
                >
                  {(() => {
                    const time = formatSimTime(event.time)
                    const counts = countTokens(event)
                    const summary = eventSummaries?.get(`e${event.step}`)
                    return (
                      <>
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <Badge variant="outline" className="shrink-0 tabular-nums">{event.step}</Badge>
                            <span className="truncate text-sm font-medium">{event.transitionName.replace(/\n/g, ' ')}</span>
                          </div>
                          <span
                            className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
                            title={time.full}
                          >
                            {time.clock}
                          </span>
                        </div>

                        {/* What the event did, in figures. The counts are what makes one
                            row worth opening over another — the transition name alone
                            repeats dozens of times in a run. */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-none text-muted-foreground">
                          {time.date && (
                            <span className="tabular-nums" title={time.full}>{time.date}</span>
                          )}
                          <span
                            className="inline-flex items-center gap-1 tabular-nums"
                            title={`${counts.consumed} token(s) consumed → ${counts.produced} produced, across ${counts.places} place(s)`}
                          >
                            <ArrowRightLeft className="h-3 w-3 shrink-0" aria-hidden />
                            {counts.consumed}→{counts.produced}
                          </span>
                          {summary && summary.objects > 0 && (
                            <span
                              className="inline-flex items-center gap-1 tabular-nums"
                              title={`${summary.objects} object relationship(s) in the OCEL export`}
                            >
                              <Box className="h-3 w-3 shrink-0" aria-hidden />
                              {summary.objects}
                            </span>
                          )}
                          {summary && summary.objectTypes > 0 && (
                            <span
                              className="inline-flex items-center gap-1 tabular-nums"
                              title={`${summary.objectTypes} distinct object type(s) involved`}
                            >
                              <LayoutGrid className="h-3 w-3 shrink-0" aria-hidden />
                              {summary.objectTypes}
                            </span>
                          )}
                        </div>
                      </>
                    )
                  })()}

                  {expandedEvents.has(event.id) && (
                    <div className="mt-2 pt-2 border-t text-sm space-y-3 overflow-hidden">
                      <div className="min-w-0">
                        <h4 className="font-medium mb-1">Consumed Tokens:</h4>
                        {event.tokens.consumed.length === 0 ? (
                          <p className="text-muted-foreground text-xs pl-2">None</p>
                        ) : (
                          <ul className="space-y-1 pl-2 text-xs">
                            {event.tokens.consumed.map((token, idx) => (
                              <li key={`consumed-${idx}`} className="min-w-0">
                                <span className="text-muted-foreground">{token.placeName.replace(/\n/g, ' ')}:</span>
                                <span className="font-mono bg-muted px-1 rounded ml-2 break-all whitespace-pre-wrap">{token.tokens}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-medium mb-1">Produced Tokens:</h4>
                        {event.tokens.produced.length === 0 ? (
                           <p className="text-muted-foreground text-xs pl-2">None</p>
                        ) : (
                          <ul className="space-y-1 pl-2 text-xs">
                            {event.tokens.produced.map((token, idx) => (
                              <li key={`produced-${idx}`} className="min-w-0">
                                <span className="text-muted-foreground">{token.placeName.replace(/\n/g, ' ')}:</span>
                                <span className="font-mono bg-muted px-1 rounded ml-2 break-all whitespace-pre-wrap">{token.tokens}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>

      {/* Transition Filter Dialog */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Filter Transitions</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
            <Button variant="outline" size="sm" onClick={selectNone}>Select None</Button>
            <Button
              variant="outline"
              size="sm"
              onClick={selectModelDefault}
              disabled={!filterDivergesFromModel}
              title="Select exactly the transitions the model marks for OCEL export"
            >
              Model Default
            </Button>
            {/* Sort toggle sits apart from the selection actions: it changes what you see,
                not what is selected. */}
            <Button
              variant={sortAlphabetically ? 'secondary' : 'ghost'}
              size="icon"
              className="ml-auto h-8 w-8"
              onClick={() => setSortAlphabetically(!sortAlphabetically)}
              aria-pressed={sortAlphabetically}
              title={sortAlphabetically ? 'Sorted A–Z — click for model order' : 'Sort alphabetically'}
            >
              <ArrowDownAZ className="h-4 w-4" />
              <span className="sr-only">Sort alphabetically</span>
            </Button>
          </div>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2 py-1">
              {listedTransitions.map(t => (
                <label key={t.id} className="flex items-center gap-2 cursor-pointer px-1 py-1 rounded hover:bg-muted/50">
                  <Checkbox
                    checked={tempFilterIds.has(t.id)}
                    onCheckedChange={(checked) => toggleTempFilter(t.id, !!checked)}
                  />
                  <span className="text-sm">{t.name.replace(/\n/g, ' ')}</span>
                  {t.involvesRecordType && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">OCEL</Badge>
                  )}
                  {t.excludedByModel && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 text-muted-foreground"
                      title="This transition is set not to appear in the OCEL export (Transition properties)"
                    >
                      excluded
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </ScrollArea>
          <p className="text-xs text-muted-foreground">
            Selected transitions appear in the log and in an OCEL export. The selection starts
            from each transition's own <em>Include in OCEL export</em> setting; changing it here
            affects this session only, not the model.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilterDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveFilter}>Apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
