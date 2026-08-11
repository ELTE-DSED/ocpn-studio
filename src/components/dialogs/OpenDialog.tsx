import type React from "react";

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Upload, FileUp, Plane, PlaneTakeoff, Package } from "lucide-react"
import { toast } from "sonner"
import * as fsa from "@/utils/fileSystemAccess"

/**
 * Bundled models offered as a starting point. Each `file` is served from public/examples,
 * so adding one is a matter of dropping the .ocpn in there and adding a row here.
 */
const EXAMPLES = [
  { file: "airport.ocpn", label: "Airport Ground Handling (Simple)", icon: Plane },
  { file: "airport-extended.ocpn", label: "Airport Ground Handling (Extended)", icon: PlaneTakeoff },
  { file: "order-management.ocpn", label: "Order Management", icon: Package },
] as const

interface OpenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `handle` is non-null only when the browser handed one over, which makes Save overwrite
   *  the original file instead of downloading a copy. */
  onFileLoaded: (fileContent: string, fileName: string, handle: FileSystemFileHandle | null) => void
}

export function OpenDialog({ open, onOpenChange, onFileLoaded }: OpenDialogProps) {
  const [isDragging, setIsDragging] = useState(false)
  // Which example is being fetched, so only that one shows as busy rather than the whole row.
  const [loadingExample, setLoadingExample] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    // A dropped item can also yield a writable handle, so a drag-and-drop open is just as
    // save-able as one through the picker. Falls back to the plain File where it cannot.
    const item = e.dataTransfer.items?.[0] as (DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
    }) | undefined
    if (item?.getAsFileSystemHandle) {
      try {
        const handle = await item.getAsFileSystemHandle()
        if (handle && handle.kind === "file") {
          const fileHandle = handle as FileSystemFileHandle
          const file = await fileHandle.getFile()
          onFileLoaded(await file.text(), file.name, fileHandle)
          onOpenChange(false)
          return
        }
      } catch {
        // Fall through to the FileReader path below.
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      readFile(e.dataTransfer.files[0])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0]
      readFile(file)
    }
  }

  const readFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      if (e.target?.result) {
        onFileLoaded(e.target.result as string, file.name, null)
        onOpenChange(false)
      }
    }
    reader.readAsText(file)
  }

  const handleOpenFileClick = async () => {
    // Where the File System Access API exists, go through its picker so the app keeps a
    // handle to the file. Elsewhere fall back to the hidden <input type="file">.
    if (!fsa.isSupported()) {
      fileInputRef.current?.click()
      return
    }
    try {
      const opened = await fsa.openWithPicker()
      if (!opened) return // cancelled
      onFileLoaded(opened.content, opened.fileName, opened.handle)
      onOpenChange(false)
    } catch (error) {
      console.error("Error opening file:", error)
      toast.error("Could not open that file.")
    }
  }

  const handleLoadExample = async (file: string) => {
    setLoadingExample(file)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/${file}`)
      if (!response.ok) {
        throw new Error(`Failed to load example file (${response.status})`)
      }
      const content = await response.text()
      // An example fetched over HTTP has no file on disk to write back to.
      onFileLoaded(content, file, null)
      onOpenChange(false)
    } catch (error) {
      console.error('Error loading example:', error)
      toast.error("Could not load that example.")
    } finally {
      setLoadingExample(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Open Petri Net</DialogTitle>
          <DialogDescription>
            Open an OCPN Studio .ocpn model, or import a CPN Tools .cpn, PNML .pnml, or
            cpn-py JSON file. Imported models are saved as .ocpn.
          </DialogDescription>
        </DialogHeader>
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/25"
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex flex-col items-center justify-center gap-2">
            <Upload className="h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Drag & Drop</h3>
            <p className="text-sm text-muted-foreground mb-4">Drop your Petri Net file here, or click to browse</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.json,.cpn,.ocpn,.pnml"
              className="hidden"
              onChange={handleFileInputChange}
            />
            <Button onClick={handleOpenFileClick} variant="outline">
              <FileUp className="mr-2 h-4 w-4" />
              Open File...
            </Button>
          </div>
        </div>
        {/* One example per row: the names are long enough that a two-column grid truncates
            them, and a list stays readable however many examples get added. */}
        <div className="space-y-1.5 text-sm">
          <span className="text-muted-foreground">Or try an example:</span>
          <div className="flex flex-col items-start gap-1">
            {EXAMPLES.map(({ file, label, icon: Icon }) => (
              <Button
                key={file}
                variant="link"
                className="p-0 h-auto text-sm justify-start"
                onClick={() => void handleLoadExample(file)}
                disabled={loadingExample !== null}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span>{loadingExample === file ? `Loading ${label}\u2026` : label}</span>
              </Button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

