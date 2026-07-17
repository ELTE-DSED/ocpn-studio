import type React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Upload } from 'lucide-react';
import useStore from '@/stores/store';

export interface TimedToken {
  value: unknown;
  timestamp: number; // in milliseconds from epoch (simulation time 0)
}

export interface RecordAttribute {
  name: string;
  type: string;
}

interface TimedMarkingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  colorSetName: string;
  colorSetType: 'int' | 'bool' | 'string' | 'unit' | 'other';
  /** Record attributes for record-type color sets */
  recordAttributes?: RecordAttribute[];
  initialData: TimedToken[];
  onSave: (tokens: TimedToken[]) => void;
  /** Dialog title prefix — defaults to "Edit Timed Marking" (the original, model-editing
   * use of this dialog); pass e.g. "Edit Current Marking" when reusing it to edit a place's
   * live marking mid-simulation instead. */
  titleLabel?: string;
}

interface TokenEditorRowProps {
  token: TimedToken;
  index: number;
  colorSetType: 'int' | 'bool' | 'string' | 'unit' | 'other';
  epoch: Date | null;
  onChange: (index: number, token: TimedToken) => void;
  onRemove: (index: number) => void;
}

// Parse relative time input (ms, s, m, h, d) to milliseconds
function parseRelativeTime(ms: number, s: number, m: number, h: number, d: number): number {
  return ms + (s * 1000) + (m * 60 * 1000) + (h * 60 * 60 * 1000) + (d * 24 * 60 * 60 * 1000);
}

// Convert milliseconds to relative time parts
function msToRelativeTime(totalMs: number): { ms: number; s: number; m: number; h: number; d: number } {
  let remaining = totalMs;
  const d = Math.floor(remaining / (24 * 60 * 60 * 1000));
  remaining %= 24 * 60 * 60 * 1000;
  const h = Math.floor(remaining / (60 * 60 * 1000));
  remaining %= 60 * 60 * 1000;
  const m = Math.floor(remaining / (60 * 1000));
  remaining %= 60 * 1000;
  const s = Math.floor(remaining / 1000);
  const ms = remaining % 1000;
  return { ms, s, m, h, d };
}

// Format milliseconds to compact relative time string
function formatRelativeTime(totalMs: number): string {
  const { d, h, m, s, ms } = msToRelativeTime(totalMs);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  if (ms > 0) parts.push(`${ms}ms`);
  return parts.length > 0 ? parts.join(' ') : '0';
}

// Convert epoch + ms to ISO datetime string for input
function msToDatetime(ms: number, epoch: Date): string {
  const date = new Date(epoch.getTime() + ms);
  return date.toISOString().slice(0, 16);
}

// Convert datetime string to ms from epoch
function datetimeToMs(datetime: string, epoch: Date): number {
  const date = new Date(datetime);
  return date.getTime() - epoch.getTime();
}

// Parse value based on attribute type
function parseValue(value: string, type: string): string | number | boolean {
  const upperType = type.toUpperCase();
  if (upperType === 'INT') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  } else if (upperType === 'REAL') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0.0 : parsed;
  } else if (upperType === 'BOOL') {
    return value.toLowerCase() === 'true';
  }
  return value;
}

// Create a default record value from attributes
function createDefaultRecord(attributes: RecordAttribute[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  attributes.forEach((attr) => {
    const upperType = attr.type.toUpperCase();
    if (upperType === 'INT') record[attr.name] = 0;
    else if (upperType === 'REAL') record[attr.name] = 0.0;
    else if (upperType === 'BOOL') record[attr.name] = false;
    else record[attr.name] = '';
  });
  return record;
}

// === Simple row editor for non-record types ===

function TokenEditorRow({ token, index, colorSetType, epoch, onChange, onRemove }: TokenEditorRowProps) {
  const [timeMode, setTimeMode] = useState<'relative' | 'absolute'>('relative');
  const relTime = msToRelativeTime(token.timestamp);
  const [relativeTime, setRelativeTime] = useState(relTime);
  const [absoluteTime, setAbsoluteTime] = useState(epoch ? msToDatetime(token.timestamp, epoch) : '');

  /* eslint-disable react-hooks/set-state-in-effect -- Bidirectional sync from prop */
  useEffect(() => {
    const newRelTime = msToRelativeTime(token.timestamp);
    setRelativeTime(newRelTime);
    if (epoch) {
      setAbsoluteTime(msToDatetime(token.timestamp, epoch));
    }
  }, [token.timestamp, epoch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleValueChange = (newValue: unknown) => {
    onChange(index, { ...token, value: newValue });
  };

  const handleRelativeTimeChange = (field: keyof typeof relativeTime, value: number) => {
    const newRelTime = { ...relativeTime, [field]: value };
    setRelativeTime(newRelTime);
    const newMs = parseRelativeTime(newRelTime.ms, newRelTime.s, newRelTime.m, newRelTime.h, newRelTime.d);
    onChange(index, { ...token, timestamp: newMs });
  };

  const handleAbsoluteTimeChange = (datetime: string) => {
    setAbsoluteTime(datetime);
    if (epoch) {
      const newMs = datetimeToMs(datetime, epoch);
      onChange(index, { ...token, timestamp: newMs });
    }
  };

  const renderValueInput = () => {
    switch (colorSetType) {
      case 'int':
        return (
          <Input type="number" value={token.value as number}
            onChange={(e) => handleValueChange(parseInt(e.target.value, 10) || 0)}
            className="w-24" />
        );
      case 'bool':
        return (
          <select value={String(token.value)}
            onChange={(e) => handleValueChange(e.target.value === 'true')}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        );
      case 'string':
        return (
          <Input type="text" value={token.value as string}
            onChange={(e) => handleValueChange(e.target.value)}
            className="w-32" />
        );
      case 'unit':
        return <span className="px-2 py-1 text-muted-foreground">()</span>;
      default:
        return (
          <Input type="text" value={JSON.stringify(token.value)}
            onChange={(e) => {
              try { handleValueChange(JSON.parse(e.target.value)); }
              catch { handleValueChange(e.target.value); }
            }}
            className="w-32" />
        );
    }
  };

  return (
    <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
      <span className="text-sm text-muted-foreground w-6">#{index + 1}</span>
      <div className="flex items-center gap-1">
        <Label className="text-xs">Value:</Label>
        {renderValueInput()}
      </div>
      <div className="flex items-center gap-2 flex-1">
        <Label className="text-xs">Time:</Label>
        <Tabs value={timeMode} onValueChange={(v) => setTimeMode(v as 'relative' | 'absolute')} className="flex-1">
          <TabsList className="h-7">
            <TabsTrigger value="relative" className="text-xs px-2 py-1">Relative</TabsTrigger>
            <TabsTrigger value="absolute" className="text-xs px-2 py-1" disabled={!epoch}>Absolute</TabsTrigger>
          </TabsList>
          <TabsContent value="relative" className="mt-1">
            <div className="flex items-center gap-1 flex-wrap">
              {(['d', 'h', 'm', 's'] as const).map((unit) => (
                <div key={unit} className="flex items-center gap-0.5">
                  <Input type="number" min="0"
                    max={unit === 'h' ? 23 : unit === 'm' || unit === 's' ? 59 : undefined}
                    value={relativeTime[unit]}
                    onChange={(e) => handleRelativeTimeChange(unit, parseInt(e.target.value, 10) || 0)}
                    className="w-12 h-7 text-xs" />
                  <span className="text-xs text-muted-foreground">{unit}</span>
                </div>
              ))}
              <div className="flex items-center gap-0.5">
                <Input type="number" min="0" max="999" value={relativeTime.ms}
                  onChange={(e) => handleRelativeTimeChange('ms', parseInt(e.target.value, 10) || 0)}
                  className="w-14 h-7 text-xs" />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="absolute" className="mt-1">
            {epoch ? (
              <Input type="datetime-local" value={absoluteTime}
                onChange={(e) => handleAbsoluteTimeChange(e.target.value)}
                className="h-7 text-xs" />
            ) : (
              <p className="text-xs text-muted-foreground">Set simulation epoch in Settings to use absolute time</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemove(index)}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// === Pagination ===

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function PaginationControls({ currentPage, totalPages, pageSize, totalItems, onPageChange, onPageSizeChange }: PaginationControlsProps) {
  const startItem = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex items-center justify-between pt-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{startItem}–{endItem} of {totalItems}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[70px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs">per page</span>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(1)} disabled={currentPage <= 1}>
          <ChevronsLeft className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1}>
          <ChevronLeft className="h-3 w-3" />
        </Button>
        <span className="text-sm px-2">{currentPage} / {totalPages || 1}</span>
        <Button variant="outline" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages}>
          <ChevronRight className="h-3 w-3" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7"
          onClick={() => onPageChange(totalPages)} disabled={currentPage >= totalPages}>
          <ChevronsRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// === Inline timestamp editor for table cells ===

interface TimestampCellEditorProps {
  timestamp: number;
  epoch: Date | null;
  onChange: (newTimestamp: number) => void;
}

function TimestampCellEditor({ timestamp, epoch, onChange }: TimestampCellEditorProps) {
  const [editing, setEditing] = useState(false);
  const [timeMode, setTimeMode] = useState<'relative' | 'absolute'>('relative');
  const [relativeTime, setRelativeTime] = useState(msToRelativeTime(timestamp));
  const [absoluteTime, setAbsoluteTime] = useState(epoch ? msToDatetime(timestamp, epoch) : '');

  /* eslint-disable react-hooks/set-state-in-effect -- Bidirectional sync from prop */
  useEffect(() => {
    setRelativeTime(msToRelativeTime(timestamp));
    if (epoch) setAbsoluteTime(msToDatetime(timestamp, epoch));
  }, [timestamp, epoch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleFieldChange = (field: keyof ReturnType<typeof msToRelativeTime>, value: number) => {
    const newRelTime = { ...relativeTime, [field]: value };
    setRelativeTime(newRelTime);
    onChange(parseRelativeTime(newRelTime.ms, newRelTime.s, newRelTime.m, newRelTime.h, newRelTime.d));
  };

  const handleAbsoluteChange = (datetime: string) => {
    setAbsoluteTime(datetime);
    if (epoch) onChange(datetimeToMs(datetime, epoch));
  };

  // Display value when not editing
  const displayValue = timeMode === 'absolute' && epoch
    ? new Date(epoch.getTime() + timestamp).toLocaleString()
    : epoch ? formatRelativeTime(timestamp) : String(timestamp);

  const tooltip = timeMode === 'absolute'
    ? (epoch ? formatRelativeTime(timestamp) : String(timestamp))
    : (epoch ? new Date(epoch.getTime() + timestamp).toLocaleString() : String(timestamp));

  if (!editing) {
    return (
      <button
        className="text-left text-sm font-mono hover:bg-muted/50 rounded px-1 py-0.5 w-full"
        onClick={() => setEditing(true)}
        title={tooltip}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <div className="space-y-1" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) setEditing(false);
    }}>
      <div className="flex items-center gap-0.5">
        <button
          className={`text-[10px] px-1.5 py-0.5 rounded ${timeMode === 'relative' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
          onClick={() => setTimeMode('relative')}
        >Rel</button>
        <button
          className={`text-[10px] px-1.5 py-0.5 rounded ${timeMode === 'absolute' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'} ${!epoch ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={() => { if (epoch) setTimeMode('absolute'); }}
          disabled={!epoch}
        >Abs</button>
      </div>
      {timeMode === 'absolute' && epoch ? (
        <Input type="datetime-local" value={absoluteTime}
          onChange={(e) => handleAbsoluteChange(e.target.value)}
          className="h-7 text-xs" autoFocus />
      ) : (
        <div className="flex items-center gap-0.5 flex-wrap">
          {(['d', 'h', 'm', 's'] as const).map((unit) => (
            <div key={unit} className="flex items-center gap-0.5">
              <Input type="number" min="0"
                max={unit === 'h' ? 23 : unit === 'm' || unit === 's' ? 59 : undefined}
                value={relativeTime[unit]}
                onChange={(e) => handleFieldChange(unit, parseInt(e.target.value, 10) || 0)}
                className="w-10 h-6 text-xs p-1"
                autoFocus={unit === 'd'} />
              <span className="text-[10px] text-muted-foreground">{unit}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// === Main dialog ===

export function TimedMarkingDialog({
  open,
  onOpenChange,
  colorSetName,
  colorSetType,
  recordAttributes,
  initialData,
  onSave,
  titleLabel = "Edit Timed Marking",
}: TimedMarkingDialogProps) {
  const [tokens, setTokens] = useState<TimedToken[]>(initialData);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [jsonText, setJsonText] = useState('');
  const [activeTab, setActiveTab] = useState('visual');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const simulationEpoch = useStore((state) => state.simulationEpoch);
  const epoch = simulationEpoch ? new Date(simulationEpoch) : null;

  const isRecordType = recordAttributes && recordAttributes.length > 0;

  /* eslint-disable react-hooks/set-state-in-effect -- Dialog data reset on open */
  useEffect(() => {
    setTokens(initialData);
    setCurrentPage(1);
  }, [initialData, open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect -- Bidirectional sync between visual and JSON views */
  useEffect(() => {
    if (activeTab === 'visual') {
      setJsonText(JSON.stringify(tokens, null, 2));
    }
  }, [tokens, activeTab]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const totalPages = Math.max(1, Math.ceil(tokens.length / pageSize));
  const paginatedTokens = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return tokens.slice(start, start + pageSize);
  }, [tokens, currentPage, pageSize]);

  const globalIndex = (pageIndex: number) => (currentPage - 1) * pageSize + pageIndex;

  const handleAddToken = () => {
    let defaultValue: unknown;
    if (isRecordType) {
      defaultValue = createDefaultRecord(recordAttributes);
    } else {
      defaultValue = colorSetType === 'int' ? 0 :
        colorSetType === 'bool' ? true :
        colorSetType === 'string' ? '' :
        colorSetType === 'unit' ? null : '';
    }
    const newTokens = [...tokens, { value: defaultValue, timestamp: 0 }];
    setTokens(newTokens);
    // Jump to last page
    setCurrentPage(Math.ceil(newTokens.length / pageSize));
  };

  const handleTokenChange = (index: number, token: TimedToken) => {
    const newTokens = [...tokens];
    newTokens[index] = token;
    setTokens(newTokens);
  };

  const handleRemoveToken = (index: number) => {
    const newTokens = tokens.filter((_, i) => i !== index);
    setTokens(newTokens);
    const newTotalPages = Math.max(1, Math.ceil(newTokens.length / pageSize));
    if (currentPage > newTotalPages) setCurrentPage(newTotalPages);
  };

  const handleRecordFieldChange = (tokenIndex: number, fieldName: string, fieldType: string, rawValue: string) => {
    const newTokens = [...tokens];
    const currentValue = newTokens[tokenIndex].value as Record<string, unknown>;
    newTokens[tokenIndex] = {
      ...newTokens[tokenIndex],
      value: { ...currentValue, [fieldName]: parseValue(rawValue, fieldType) },
    };
    setTokens(newTokens);
  };

  const handleTimestampChange = (tokenIndex: number, newTimestamp: number) => {
    const newTokens = [...tokens];
    newTokens[tokenIndex] = { ...newTokens[tokenIndex], timestamp: newTimestamp };
    setTokens(newTokens);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
  };

  // CSV template download (includes Timestamp column)
  const generateCsvTemplate = () => {
    if (!isRecordType) return;
    const headers = [...recordAttributes.map((attr) => attr.name), 'Timestamp'].join(',');
    const csvContent = `data:text/csv;charset=utf-8,${headers}\n`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${colorSetName}_timed_template.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // File upload (JSON or CSV)
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        // Try JSON first
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          setTokens(parsed as TimedToken[]);
          setCurrentPage(1);
          setActiveTab('visual');
          setJsonError(null);
        } else {
          setJsonError('Uploaded file must contain an array');
        }
      } catch {
        // Try CSV
        if (!isRecordType) {
          setJsonError('Non-record types only support JSON import');
          return;
        }
        try {
          const lines = content.split('\n');
          const headers = lines[0].split(',').map((h) => h.trim());
          const tsIndex = headers.findIndex((h) => h.toLowerCase() === 'timestamp');
          const fieldHeaders = headers.filter((_, i) => i !== tsIndex);

          const parsedTokens: TimedToken[] = [];
          for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = lines[i].split(',').map((v) => v.trim());
            const record: Record<string, unknown> = {};

            fieldHeaders.forEach((header) => {
              const colIdx = headers.indexOf(header);
              const attr = recordAttributes.find((a) => a.name === header);
              if (attr && colIdx >= 0 && colIdx < values.length) {
                record[header] = parseValue(values[colIdx], attr.type);
              }
            });

            const timestamp = tsIndex >= 0 && tsIndex < values.length
              ? (parseInt(values[tsIndex], 10) || 0)
              : 0;

            parsedTokens.push({ value: record, timestamp });
          }

          setTokens(parsedTokens);
          setCurrentPage(1);
          setActiveTab('visual');
          setJsonError(null);
        } catch {
          setJsonError('Failed to parse file as JSON or CSV');
        }
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-uploaded
    event.target.value = '';
  };

  const handleTabChange = (value: string) => {
    if (value === 'json' && activeTab === 'visual') {
      setJsonText(JSON.stringify(tokens, null, 2));
    } else if (value === 'visual' && activeTab === 'json') {
      try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
          setTokens(parsed);
          setJsonError(null);
        } else {
          setJsonError('JSON must be an array');
        }
      } catch {
        setJsonError('Invalid JSON format');
      }
    }
    setActiveTab(value);
  };

  const handleSave = () => {
    if (activeTab === 'json') {
      try {
        const parsed = JSON.parse(jsonText);
        if (Array.isArray(parsed)) {
          onSave(parsed);
          onOpenChange(false);
        } else {
          setJsonError('JSON must be an array');
        }
      } catch {
        setJsonError('Invalid JSON format');
      }
    } else {
      onSave(tokens);
      onOpenChange(false);
    }
  };

  const renderPagination = () => tokens.length > 10 ? (
    <PaginationControls
      currentPage={currentPage} totalPages={totalPages}
      pageSize={pageSize} totalItems={tokens.length}
      onPageChange={setCurrentPage} onPageSizeChange={handlePageSizeChange}
    />
  ) : null;

  const renderRecordTable = () => (
    <div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {recordAttributes!.map((attr) => (
                <TableHead key={attr.name}>{attr.name}</TableHead>
              ))}
              <TableHead className="min-w-[160px]">Timestamp</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedTokens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={recordAttributes!.length + 2} className="text-center text-muted-foreground py-8">
                  No tokens. Click &quot;Add Token&quot; to add one.
                </TableCell>
              </TableRow>
            ) : (
              paginatedTokens.map((token, pageIdx) => {
                const idx = globalIndex(pageIdx);
                const record = (token.value || {}) as Record<string, unknown>;
                return (
                  <TableRow key={idx}>
                    {recordAttributes!.map((attr) => (
                      <TableCell key={attr.name} className="p-1">
                        <Input
                          value={record[attr.name]?.toString() ?? ''}
                          onChange={(e) => handleRecordFieldChange(idx, attr.name, attr.type, e.target.value)}
                          className="h-7 text-xs"
                        />
                      </TableCell>
                    ))}
                    <TableCell className="p-1">
                      <TimestampCellEditor
                        timestamp={token.timestamp} epoch={epoch}
                        onChange={(ts) => handleTimestampChange(idx, ts)}
                      />
                    </TableCell>
                    <TableCell className="p-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveToken(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
      {renderPagination()}
    </div>
  );

  const renderSimpleList = () => (
    <div>
      <div className="space-y-2">
        {paginatedTokens.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No tokens. Click &quot;Add Token&quot; to add a timed token.
          </div>
        ) : (
          paginatedTokens.map((token, pageIdx) => {
            const idx = globalIndex(pageIdx);
            return (
              <TokenEditorRow key={idx} token={token} index={idx}
                colorSetType={colorSetType} epoch={epoch}
                onChange={handleTokenChange} onRemove={handleRemoveToken}
              />
            );
          })
        )}
      </div>
      {renderPagination()}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isRecordType ? 'max-w-[90vw] sm:max-w-[90vw] xl:max-w-6xl' : 'max-w-3xl sm:max-w-3xl'}>
        <DialogHeader>
          <DialogTitle>{titleLabel} for {colorSetName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {tokens.length} token{tokens.length !== 1 ? 's' : ''}
              {epoch && <span className="ml-2">(Epoch: {epoch.toLocaleString()})</span>}
            </div>
            <div className="flex items-center gap-2">
              {isRecordType && (
                <Button variant="outline" size="sm" onClick={generateCsvTemplate}>
                  <Download className="h-4 w-4 mr-1" />
                  CSV Template
                </Button>
              )}
              <div>
                <Input type="file" id="timed-file-upload" className="hidden" accept=".json,.csv" onChange={handleFileUpload} />
                <Label htmlFor="timed-file-upload" className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span>
                      <Upload className="h-4 w-4 mr-1" />
                      Import
                    </span>
                  </Button>
                </Label>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddToken}>
                <Plus className="h-4 w-4 mr-1" />
                Add Token
              </Button>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="visual">Visual Editor</TabsTrigger>
              <TabsTrigger value="json">JSON Editor</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="space-y-2">
              {isRecordType ? renderRecordTable() : renderSimpleList()}
            </TabsContent>
            <TabsContent value="json">
              <div className="space-y-2">
                <Label htmlFor="timed-json-editor">JSON Editor</Label>
                <textarea
                  id="timed-json-editor"
                  className="w-full h-[300px] font-mono text-sm p-2 border rounded-md"
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError(null);
                    try {
                      const parsed = JSON.parse(e.target.value);
                      if (!Array.isArray(parsed)) setJsonError('JSON must be an array');
                    } catch {
                      setJsonError('Invalid JSON format');
                    }
                  }}
                />
                {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
