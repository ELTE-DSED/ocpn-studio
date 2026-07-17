import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Coffee } from "lucide-react";

const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/istvank";

interface SupportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SupportDialog({ open, onOpenChange }: SupportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Support OCPN Studio</DialogTitle>
          <DialogDescription>
            OCPN Studio is free and open source, built and maintained in my spare time. To develop it
            faster, I use paid AI tooling that costs money per token — if it's been useful to you, a
            coffee helps cover that and keeps development going. Or just say thanks — that means a lot
            too!
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-between gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Maybe later
          </Button>
          <Button asChild>
            <a href={BUY_ME_A_COFFEE_URL} target="_blank" rel="noopener noreferrer">
              <Coffee className="mr-2 h-4 w-4" />
              Buy me a coffee
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
