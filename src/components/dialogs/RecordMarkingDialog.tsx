import type React from "react"

import { useState, useEffect, useMemo } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PlusCircle, Trash2, Upload, Download, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// Define the type for values within a record (can be anything JSON-serializable)
type RecordValue = string | number | boolean | unknown[] | Record<string, unknown>
// Define the type for a single record object
type RecordData = Record<string, RecordValue>
// For multiset mode, entries can be any JSON value
type MultisetEntry = string | number | boolean | unknown[] | Record<string, unknown>

interface RecordAttribute {
  name: string
  type: string
}

interface RecordMarkingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  colorSetName: string
  attributes: RecordAttribute[]
  initialData: RecordData[] | MultisetEntry[]
  onSave: (data: RecordData[] | MultisetEntry[]) => void
  /** Dialog title prefix — defaults to "Edit Initial Marking" (the original, model-editing
   * use of this dialog); pass e.g. "Edit Current Marking" when reusing it to edit a place's
   * live marking mid-simulation instead. */
  titleLabel?: string
}

export function RecordMarkingDialog({
  open,
  onOpenChange,
  colorSetName,
  attributes,
  initialData,
  onSave,
  titleLabel = "Edit Initial Marking",
}: RecordMarkingDialogProps) {
  const [activeTab, setActiveTab] = useState("visual")
  const [records, setRecords] = useState<RecordData[]>([])
  const [multisetEntries, setMultisetEntries] = useState<MultisetEntry[]>([])
  const [jsonText, setJsonText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  // Raw text of the cell currently being edited. Numeric cells display their parsed value,
  // so without this an in-progress "3." or "-" would be collapsed by parseValue (to 3 / 0)
  // and re-rendered without the character just typed — making decimals and negatives
  // impossible to enter. Only the focused cell uses the draft; blur re-normalizes it.
  const [draft, setDraft] = useState<{ key: string; text: string } | null>(null)

  // Determine if we're in record mode (named attributes) or multiset mode (generic entries)
  const isRecordMode = attributes.length > 0

  // Initialize data from initialData
  /* eslint-disable react-hooks/set-state-in-effect -- Dialog data init from props */
  useEffect(() => {
    if (initialData && Array.isArray(initialData)) {
      if (isRecordMode) {
        setRecords(initialData as RecordData[])
      } else {
        setMultisetEntries(initialData as MultisetEntry[])
      }
      setJsonText(JSON.stringify(initialData, null, 2))
    } else {
      setRecords([])
      setMultisetEntries([])
      setJsonText("[]")
    }
    setCurrentPage(1)
    setDraft(null)
  }, [initialData, isRecordMode])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Pagination
  const dataLength = isRecordMode ? records.length : multisetEntries.length
  const totalPages = Math.max(1, Math.ceil(dataLength / pageSize))
  const paginatedRecords = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return records.slice(start, start + pageSize)
  }, [records, currentPage, pageSize])
  const paginatedMultisetEntries = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return multisetEntries.slice(start, start + pageSize)
  }, [multisetEntries, currentPage, pageSize])
  const globalIndex = (pageIndex: number) => (currentPage - 1) * pageSize + pageIndex
  const handlePageSizeChange = (newSize: number) => { setPageSize(newSize); setCurrentPage(1) }

  // Update JSON text when data changes
  /* eslint-disable react-hooks/set-state-in-effect -- Bidirectional sync between visual and JSON views */
  useEffect(() => {
    if (activeTab === "visual") {
      const data = isRecordMode ? records : multisetEntries
      setJsonText(JSON.stringify(data, null, 2))
    }
  }, [records, multisetEntries, activeTab, isRecordMode])
  /* eslint-enable react-hooks/set-state-in-effect */

  // === Multiset mode functions ===
  
  // Add a new multiset entry (default to empty string, user will edit)
  const addMultisetEntry = () => {
    const newEntries = [...multisetEntries, ""]
    setMultisetEntries(newEntries)
    setCurrentPage(Math.ceil(newEntries.length / pageSize))
  }

  // Delete a multiset entry
  const deleteMultisetEntry = (index: number) => {
    const newEntries = [...multisetEntries]
    newEntries.splice(index, 1)
    setMultisetEntries(newEntries)
    setDraft(null) // indices shift, so an index-keyed draft would land on the wrong row
    const newTotal = Math.max(1, Math.ceil(newEntries.length / pageSize))
    if (currentPage > newTotal) setCurrentPage(newTotal)
  }

  // Update a multiset entry - try to parse as JSON if it looks like an array/object
  const updateMultisetEntry = (index: number, value: string) => {
    const newEntries = [...multisetEntries]
    
    // Try to parse as JSON (for product types like [1, "Modellin"])
    try {
      if ((value.startsWith('[') && value.endsWith(']')) || 
          (value.startsWith('{') && value.endsWith('}'))) {
        newEntries[index] = JSON.parse(value)
      } else if (!isNaN(Number(value)) && value.trim() !== '') {
        // It's a number
        newEntries[index] = Number(value)
      } else if (value.toLowerCase() === 'true') {
        newEntries[index] = true
      } else if (value.toLowerCase() === 'false') {
        newEntries[index] = false
      } else {
        // Keep as string
        newEntries[index] = value
      }
    } catch {
      // Keep as string if JSON parse fails
      newEntries[index] = value
    }
    
    setMultisetEntries(newEntries)
  }

  // Format a multiset entry for display in the input
  const formatMultisetEntry = (entry: MultisetEntry): string => {
    if (typeof entry === 'object') {
      return JSON.stringify(entry)
    }
    return String(entry)
  }

  // === Record mode functions ===

  // Add a new empty record, auto-incrementing the 'id' field if it's of type INT
  const addRecord = () => {
    const newRecord: RecordData = {}
    attributes.forEach((attr) => {
      // Set default values based on type
      if (attr.type === "INT") {
        newRecord[attr.name] = 0
      } else if (attr.type === "REAL") {
        newRecord[attr.name] = 0.0
      } else if (attr.type === "BOOL") {
        newRecord[attr.name] = false
      } else {
        newRecord[attr.name] = ""
      }
    })

    // Auto-increment 'id' field if it exists and is of type INT
    const idAttr = attributes.find(
      (attr) => attr.name.toLowerCase() === "id" && attr.type === "INT"
    )
    if (idAttr) {
      const existingIds = records
        .map((r) => r[idAttr.name])
        .filter((v): v is number => typeof v === "number")
      const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1
      newRecord[idAttr.name] = nextId
    }

    const newRecords = [...records, newRecord]
    setRecords(newRecords)
    setCurrentPage(Math.ceil(newRecords.length / pageSize))
  }

  // Delete a record
  const deleteRecord = (index: number) => {
    const newRecords = [...records]
    newRecords.splice(index, 1)
    setRecords(newRecords)
    setDraft(null) // indices shift, so an index-keyed draft would land on the wrong row
    const newTotal = Math.max(1, Math.ceil(newRecords.length / pageSize))
    if (currentPage > newTotal) setCurrentPage(newTotal)
  }

  // Update a record field
  const updateRecord = (index: number, field: string, value: RecordValue) => {
    const newRecords = [...records]
    newRecords[index] = { ...newRecords[index], [field]: value }
    setRecords(newRecords)
  }

  // Parse value based on type
  const parseValue = (value: string, type: string): RecordValue => {
    try {
      if (type === "INT") {
        const parsed = Number.parseInt(value, 10)
        return isNaN(parsed) ? 0 : parsed
      } else if (type === "REAL") {
        const parsed = Number.parseFloat(value)
        return isNaN(parsed) ? 0.0 : parsed
      } else if (type === "BOOL") {
        return value.toLowerCase() === "true"
      }
      return value
    } catch {
      if (type === "INT") return 0
      if (type === "REAL") return 0.0
      if (type === "BOOL") return false
      return value
    }
  }

  // Handle JSON text change
  const handleJsonChange = (text: string) => {
    setJsonText(text)
    setError(null)
    try {
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) {
        setError("JSON must be an array")
      }
    } catch {
      setError("Invalid JSON format")
    }
  }

  // Handle tab change
  const handleTabChange = (value: string) => {
    setDraft(null)
    if (value === "json" && activeTab === "visual") {
      const data = isRecordMode ? records : multisetEntries
      setJsonText(JSON.stringify(data, null, 2))
    } else if (value === "visual" && activeTab === "json") {
      try {
        const parsed = JSON.parse(jsonText)
        if (Array.isArray(parsed)) {
          if (isRecordMode) {
            setRecords(parsed as RecordData[])
          } else {
            setMultisetEntries(parsed as MultisetEntry[])
          }
          setError(null)
        } else {
          setError("JSON must be an array")
        }
      } catch {
        setError("Invalid JSON format")
      }
    }
    setActiveTab(value)
  }

  // Handle save
  const handleSave = () => {
    if (activeTab === "json") {
      try {
        const parsed = JSON.parse(jsonText)
        if (Array.isArray(parsed)) {
          onSave(parsed)
          onOpenChange(false)
        } else {
          setError("JSON must be an array")
        }
      } catch {
        setError("Invalid JSON format")
      }
    } else {
      const data = isRecordMode ? records : multisetEntries
      onSave(data)
      onOpenChange(false)
    }
  }

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      try {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) {
          if (isRecordMode) {
            setRecords(parsed as RecordData[])
          } else {
            setMultisetEntries(parsed as MultisetEntry[])
          }
          setJsonText(JSON.stringify(parsed, null, 2))
          setActiveTab("visual")
          setError(null)
        } else {
          setError("Uploaded file must contain an array")
        }
      } catch {
        try {
          const lines = content.split("\n")
          const headers = lines[0].split(",").map((h) => h.trim())

          const parsedRecords: RecordData[] = []
          for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue

            const values = lines[i].split(",").map((v) => v.trim())
            const record: RecordData = {}

            headers.forEach((header, index) => {
              const attr = attributes.find((a) => a.name === header)
              if (attr && index < values.length) {
                record[header] = parseValue(values[index], attr.type)
              }
            })

            parsedRecords.push(record)
          }

          setRecords(parsedRecords)
          setJsonText(JSON.stringify(parsedRecords, null, 2))
          setActiveTab("visual")
          setError(null)
        } catch {
          setError("Failed to parse file as JSON or CSV")
        }
      }
    }
    reader.readAsText(file)
  }

  // Generate CSV template
  const generateCsvTemplate = () => {
    const headers = attributes.map((attr) => attr.name).join(",")
    const csvContent = `data:text/csv;charset=utf-8,${headers}\n`
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `${colorSetName}_template.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titleLabel} for {colorSetName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div className="space-x-2">
              <Button variant="outline" size="sm" onClick={isRecordMode ? addRecord : addMultisetEntry}>
                <PlusCircle className="h-4 w-4 mr-2" />
                {isRecordMode ? "Add Record" : "Add Entry"}
              </Button>
              {isRecordMode && (
                <Button variant="outline" size="sm" onClick={generateCsvTemplate}>
                  <Download className="h-4 w-4 mr-2" />
                  CSV Template
                </Button>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Input type="file" id="file-upload" className="hidden" accept=".json,.csv" onChange={handleFileUpload} />
              <Label htmlFor="file-upload" className="cursor-pointer">
                <Button variant="outline" size="sm" asChild>
                  <span>
                    <Upload className="h-4 w-4 mr-2" />
                    Import
                  </span>
                </Button>
              </Label>
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="visual">Visual Editor</TabsTrigger>
              <TabsTrigger value="json">JSON Editor</TabsTrigger>
            </TabsList>
            <TabsContent value="visual" className="space-y-4">
              {isRecordMode ? (
                // Record mode: table with named columns
                <Table>
                  <TableHeader>
                    <TableRow>
                      {attributes.map((attr) => (
                        <TableHead key={attr.name}>{attr.name}</TableHead>
                      ))}
                      <TableHead className="w-[80px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRecords.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={attributes.length + 1} className="text-center">
                          No records. Click "Add Record" to create one.
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginatedRecords.map((record, pageIdx) => {
                        const idx = globalIndex(pageIdx)
                        return (
                          <TableRow key={idx}>
                            {attributes.map((attr) => {
                              const cellKey = `${idx}-${attr.name}`
                              return (
                                <TableCell key={cellKey}>
                                  <Input
                                    value={draft?.key === cellKey ? draft.text : record[attr.name]?.toString() ?? ""}
                                    onChange={(e) => {
                                      setDraft({ key: cellKey, text: e.target.value })
                                      updateRecord(idx, attr.name, parseValue(e.target.value, attr.type))
                                    }}
                                    onBlur={() => setDraft(null)}
                                  />
                                </TableCell>
                              )
                            })}
                            <TableCell>
                              <Button variant="ghost" size="icon" onClick={() => deleteRecord(idx)} className="h-8 w-8">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              ) : (
                // Multiset mode: simple list of entries
                <div className="space-y-2">
                  {paginatedMultisetEntries.length === 0 ? (
                    <div className="text-center text-muted-foreground py-4">
                      No entries. Click "Add Entry" to create one.
                    </div>
                  ) : (
                    paginatedMultisetEntries.map((entry, pageIdx) => {
                      const idx = globalIndex(pageIdx)
                      const entryKey = `entry-${idx}`
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-sm text-muted-foreground w-8 text-right">{idx + 1}.</span>
                          <Input
                            className="flex-1 font-mono"
                            value={draft?.key === entryKey ? draft.text : formatMultisetEntry(entry)}
                            onChange={(e) => {
                              setDraft({ key: entryKey, text: e.target.value })
                              updateMultisetEntry(idx, e.target.value)
                            }}
                            onBlur={() => setDraft(null)}
                            placeholder="e.g., [1, &quot;Modellin&quot;] or 42 or &quot;text&quot;"
                          />
                          <Button variant="ghost" size="icon" onClick={() => deleteMultisetEntry(idx)} className="h-8 w-8">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
              {dataLength > 10 && (
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{dataLength === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, dataLength)} of {dataLength}</span>
                    <Select value={String(pageSize)} onValueChange={(v) => handlePageSizeChange(Number(v))}>
                      <SelectTrigger className="h-7 w-[70px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100].map((size) => (
                          <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs">per page</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => setCurrentPage(1)} disabled={currentPage <= 1}>
                      <ChevronsLeft className="h-3 w-3" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage <= 1}>
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <span className="text-sm px-2">{currentPage} / {totalPages}</span>
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage >= totalPages}>
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7"
                      onClick={() => setCurrentPage(totalPages)} disabled={currentPage >= totalPages}>
                      <ChevronsRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="json">
              <div className="space-y-2">
                <Label htmlFor="json-editor">JSON Editor</Label>
                <textarea
                  id="json-editor"
                  className="w-full h-[300px] font-mono text-sm p-2 border rounded-md"
                  value={jsonText}
                  onChange={(e) => handleJsonChange(e.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
