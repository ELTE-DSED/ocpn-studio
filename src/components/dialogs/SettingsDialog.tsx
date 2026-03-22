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
import { Eye, EyeOff } from "lucide-react"

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  apiKey: string | null
  onApiKeyChange: (apiKey: string) => void
}

export function SettingsDialog({ open, onOpenChange, apiKey, onApiKeyChange }: SettingsDialogProps) {
  const [localApiKey, setLocalApiKey] = useState(apiKey || "")
  const [showApiKey, setShowApiKey] = useState(false)

  const handleSave = () => {
    onApiKeyChange(localApiKey)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your OCPN Studio preferences.</DialogDescription>
        </DialogHeader>


        <div className="space-y-2">
          <Label htmlFor="openai-api-key">OpenAI API Key</Label>
          <div className="relative">
            <Input
              id="openai-api-key"
              type={showApiKey ? "text" : "password"}
              placeholder="sk-..."
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
              className="w-full pr-10"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck="false"
              inputMode="text"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => setShowApiKey(!showApiKey)}
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Your API key is stored locally in your browser and never sent to our servers.
          </p>
        </div>
        {/* <div className="space-y-2">
          <Label htmlFor="ai-model">AI Model</Label>
          <select
            id="ai-model"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
            defaultValue="gpt-4o"
          >
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-4-turbo">GPT-4 Turbo</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
          </select>
        </div> */}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
