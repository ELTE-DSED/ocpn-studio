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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface SaveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (format: string) => void
  petriNetName: string
}

export function SaveDialog({ open, onOpenChange, onSave, petriNetName }: SaveDialogProps) {
  const [selectedFormat, setSelectedFormat] = useState<string>("json");

  const handleSave = () => {
    onSave(selectedFormat)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Petri Net</DialogTitle>
          <DialogDescription>
            Download &quot;{petriNetName}&quot; in another format. Exports are one-way copies:
            they do not become the file that Save writes to.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <RadioGroup value={selectedFormat} onValueChange={setSelectedFormat} className="space-y-3">
            <div className="flex items-start space-x-3 space-y-0">
              <RadioGroupItem value="json" id="json"/>
              <div className="grid gap-1.5">
                <Label htmlFor="json" className="font-medium">
                  OCPN JSON
                </Label>
                <p className="text-sm text-muted-foreground">
                  Simple JSON format. Best for OCPN Studio.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 space-y-0">
              <RadioGroupItem value="cpn-tools" id="cpn-tools" />
              <div className="grid gap-1.5">
                <Label htmlFor="cpn-tools" className="font-medium">
                  CPN Tools XML
                </Label>
                <p className="text-sm text-muted-foreground">
                  Standard format for CPN Tools. Best for compatibility with CPN Tools.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 space-y-0">
              <RadioGroupItem value="pnml" id="pnml" />
              <div className="grid gap-1.5">
                <Label htmlFor="pnml" className="font-medium">
                  PNML
                </Label>
                <p className="text-sm text-muted-foreground">
                  Petri Net Markup Language (ISO/IEC 15909-2). Partial support.
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3 space-y-0">
              <RadioGroupItem value="cpn-py" id="cpn-py"/>
              <div className="grid gap-1.5">
                <Label htmlFor="cpn-py" className="font-medium">
                  cpn-py JSON
                </Label>
                <p className="text-sm text-muted-foreground">
                  Format compatible with cpn-py library. Best for Python integration.
                </p>
              </div>
            </div>
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Export</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

