import { useState, useEffect, useMemo, type ReactNode } from "react";
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
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface HelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Turn a heading's rendered text into a stable id, shared between the index and the heading itself. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Flatten a heading's React children (plain text, possibly nested) back into a string for slugifying. */
function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getNodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return getNodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
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

  // Index of covered topics: every top-level (##) section, extracted straight from the
  // markdown source so it always stays in sync with the guide's actual headings.
  const tocItems = useMemo(() => {
    const items: { text: string; slug: string }[] = [];
    const headingPattern = /^##\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = headingPattern.exec(markdownContent)) !== null) {
      const text = match[1].trim();
      items.push({ text, slug: slugify(text) });
    }
    return items;
  }, [markdownContent]);

  const scrollToSection = (slug: string) => {
    document.getElementById(slug)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const markdownComponents: Components = {
    h2: ({ children, ...props }) => (
      <h2 id={slugify(getNodeText(children))} {...props}>{children}</h2>
    ),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogContent className="sm:max-w-[800px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Help & Documentation</DialogTitle>
          <DialogDescription>Learn how to use OCPN Studio with this guide.</DialogDescription>
        </DialogHeader>
        {tocItems.length > 0 && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 shrink-0">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Index</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
              {tocItems.map((item) => (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => scrollToSection(item.slug)}
                  className="text-left text-xs text-primary hover:underline truncate"
                  title={item.text}
                >
                  {item.text}
                </button>
              ))}
            </div>
          </div>
        )}
        <ScrollArea className="flex-1 pr-4 h-[60vh]">
          <div className="prose prose-sm dark:prose-invert max-w-none [&_table]:border-collapse [&_table]:w-full [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-100 [&_th]:p-2 [&_th]:text-left [&_td]:border [&_td]:border-gray-300 [&_td]:p-2 dark:[&_th]:border-gray-600 dark:[&_th]:bg-gray-800 dark:[&_td]:border-gray-600">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{markdownContent}</ReactMarkdown>
          </div>
        </ScrollArea>
        <DialogFooter className="mt-4">
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
