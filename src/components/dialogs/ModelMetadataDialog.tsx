import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Plus, X } from "lucide-react"
import type { OcpnMetadata } from "@/types"
import { GENERATOR } from "@/utils/FileOperations"

interface ModelMetadataDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ocpnName: string
  metadata: OcpnMetadata
  onSave: (ocpnName: string, metadata: OcpnMetadata) => void
}

/** One row per author, so a name containing a comma survives editing. */
function AuthorList({ authors, onChange }: { authors: string[]; onChange: (authors: string[]) => void }) {
  return (
    <div className="space-y-2">
      {authors.map((author, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={author}
            placeholder="Ada Lovelace"
            onChange={(e) => onChange(authors.map((a, i) => (i === index ? e.target.value : a)))}
            autoComplete="off"
          />
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label={`Remove author ${index + 1}`}
            onClick={() => onChange(authors.filter((_, i) => i !== index))}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...authors, ""])}>
        <Plus className="h-4 w-4 mr-1" />
        Add author
      </Button>
    </div>
  )
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "—"
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function ModelMetadataDialog({
  open,
  onOpenChange,
  ocpnName,
  metadata,
  onSave,
}: ModelMetadataDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Model Information</DialogTitle>
          <DialogDescription>
            Describes the model as a document. Saved with the .ocpn file and travels with it.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form's initial state is read fresh from the store on
            every open: a cancelled edit is genuinely discarded, and a model loaded in the
            meantime shows up. No syncing effect needed. */}
        {open && (
          <MetadataForm
            ocpnName={ocpnName}
            metadata={metadata}
            onSave={onSave}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MetadataForm({
  ocpnName,
  metadata,
  onSave,
  onClose,
}: {
  ocpnName: string
  metadata: OcpnMetadata
  onSave: (ocpnName: string, metadata: OcpnMetadata) => void
  onClose: () => void
}) {
  const [name, setName] = useState(ocpnName)
  const [description, setDescription] = useState(metadata.description ?? "")
  const [authors, setAuthors] = useState<string[]>(metadata.authors ?? [])
  const [url, setUrl] = useState(metadata.url ?? "")
  const [version, setVersion] = useState(metadata.version ?? "")
  const [license, setLicense] = useState(metadata.license ?? "")

  const handleSave = () => {
    const trimmedAuthors = authors.map((a) => a.trim()).filter(Boolean)
    onSave(name.trim() || ocpnName, {
      ...metadata,
      description: description.trim() || undefined,
      authors: trimmedAuthors.length ? trimmedAuthors : undefined,
      url: url.trim() || undefined,
      version: version.trim() || undefined,
      license: license.trim() || undefined,
    })
    onClose()
  }

  return (
    <>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="metadata-name">Name</Label>
          <Input
            id="metadata-name"
            value={name}
            placeholder="Order Management"
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Shown in the header and used for export filenames.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="metadata-description">Description</Label>
          <Textarea
            id="metadata-description"
            value={description}
            placeholder="What this model represents, and anything a reader should know before running it."
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>

        <div className="space-y-2">
          <Label>Authors</Label>
          <AuthorList authors={authors} onChange={setAuthors} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="metadata-url">URL</Label>
          <Input
            id="metadata-url"
            type="url"
            value={url}
            placeholder="https://github.com/…"
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            Repository, paper or project page this model belongs to.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="metadata-version">Version</Label>
            <Input
              id="metadata-version"
              value={version}
              placeholder="1.0"
              onChange={(e) => setVersion(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">The model&apos;s own version.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="metadata-license">License</Label>
            <Input
              id="metadata-license"
              value={license}
              placeholder="CC-BY-4.0"
              onChange={(e) => setLicense(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">SPDX identifier or free text.</p>
          </div>
        </div>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Recorded automatically</p>
          <dl className="text-xs text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt>Created</dt>
            <dd>{formatTimestamp(metadata.created)}</dd>
            <dt>Generator</dt>
            <dd>{GENERATOR}</dd>
            <dt>Modified</dt>
            <dd>stamped on save</dd>
          </dl>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave}>Save</Button>
      </DialogFooter>
    </>
  )
}
