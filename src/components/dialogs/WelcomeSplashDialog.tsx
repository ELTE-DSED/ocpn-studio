import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Puzzle, Play, Palette, Sparkles, type LucideIcon } from "lucide-react";
import pkg from "../../../package.json";

interface ReleaseHighlight {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  description: string;
}

/**
 * Highlights shown in the welcome splash, keyed by the exact package.json version they
 * shipped in. A version with no entry here simply never triggers the auto-show — e.g. a
 * patch release with nothing splash-worthy. Add a new entry whenever a release has user-
 * facing highlights worth announcing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const RELEASE_HIGHLIGHTS: Record<string, ReleaseHighlight[]> = {
  "0.7.0": [
    {
      icon: Puzzle,
      iconClassName: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
      title: "Declare support",
      description: "Add a declarative layer and draw Declare constraints directly in your models.",
    },
    {
      icon: Play,
      iconClassName: "bg-green-100 text-green-600 dark:bg-green-500/15 dark:text-green-400",
      title: "New possibilities for simulation",
      description: "See directly in the model which transitions are enabled and fire them with a single click.",
    },
    {
      icon: Palette,
      iconClassName: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
      title: "Brand-new design",
      description: "Enjoy a refreshed interface with cleaner navigation, updated styling, and a more modern look.",
    },
  ],
};

/** "0.7.0" -> "0.7", but keeps a non-zero patch (e.g. "0.7.1" stays "0.7.1"). */
function formatShortVersion(version: string): string {
  return version.replace(/\.0$/, "");
}

interface WelcomeSplashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WelcomeSplashDialog({ open, onOpenChange }: WelcomeSplashDialogProps) {
  const highlights = RELEASE_HIGHLIGHTS[pkg.version] ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] p-0 overflow-hidden gap-0">
        <div
          className="aspect-2172/724 bg-cover bg-center"
          style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/splashscreen_bg.png)` }}
        />
        <div className="px-6 pb-6 -mt-10 space-y-4">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold">Welcome to OCPN Studio</h2>
            <span className="inline-block rounded-full bg-primary/10 text-primary text-sm font-semibold px-3 py-1">
              Version {formatShortVersion(pkg.version)}
            </span>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              OCPN Studio is a modern environment to model, simulate, and analyze Colored Petri
              Nets with object-centric features. It combines an intuitive visual editor with
              powerful analysis and teaching-friendly features.
            </p>
          </div>

          {highlights.length > 0 && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background px-3 text-sm font-semibold text-primary flex items-center gap-1.5">
                    What&apos;s new <Sparkles className="h-4 w-4" />
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {highlights.map((item) => (
                  <div key={item.title} className="flex items-start gap-3 rounded-lg border p-3">
                    <span className={`flex h-15 w-15 shrink-0 items-center justify-center rounded-lg ${item.iconClassName}`}>
                      <item.icon className="h-7 w-7" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Proudly developed at{" "}
              <a
                href="https://dse.inf.elte.hu"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                ELTE University, Budapest
              </a>
              .
            </span>
            <Button onClick={() => onOpenChange(false)}>Explore what&apos;s new</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
