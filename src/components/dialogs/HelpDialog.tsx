import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const [markdownContent, setMarkdownContent] = useState<string>("")

  useEffect(() => {
    // Fetch the markdown file when the dialog opens
    if (open) {
      fetch("usage-guide.md")
        .then((response) => response.text())
        .then((text) => setMarkdownContent(text))
        .catch((error) => {
          console.error("Error loading help content:", error)
          setMarkdownContent("# Error\nFailed to load help content. Please try again later.")
        })
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Help & Documentation</DialogTitle>
          <DialogDescription>Learn how to use OCPN Studio with this guide.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 pr-4 h-[60vh]">
          <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:border-collapse [&_table]:w-full [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-gray-300 [&_td]:p-2 dark:[&_th]:border-gray-600 dark:[&_th]:bg-gray-800 dark:[&_td]:border-gray-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdownContent}</ReactMarkdown>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4">
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
