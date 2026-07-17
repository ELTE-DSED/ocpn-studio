import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info, History, Quote, FileText, Scale, Mail, Copy, Check, ExternalLink } from "lucide-react";
import pkg from "../../package.json";
import { WelcomeSplashDialog, RELEASE_HIGHLIGHTS } from "@/components/dialogs/WelcomeSplashDialog";

const LAST_SEEN_VERSION_KEY = "ocpn-studio-last-seen-version";

type DialogKey = "about" | "changelog" | "cite" | "imprint" | "licenses" | "contact";

const PRIMARY_ITEMS: { key: DialogKey; label: string; icon: typeof Info }[] = [
  { key: "about", label: "About", icon: Info },
  { key: "changelog", label: "Changelog", icon: History },
  { key: "cite", label: "Cite this Tool", icon: Quote },
];

const LEGAL_ITEMS: { key: DialogKey; label: string; icon: typeof Info }[] = [
  { key: "imprint", label: "Imprint", icon: FileText },
  { key: "licenses", label: "Licenses", icon: Scale },
  { key: "contact", label: "Contact", icon: Mail },
];

const CITATION_TEXT =
  'István Koren. "OCPN Studio: Web-Based Modeling, Simulation, and Analysis of Object-Centric Petri Nets." In: Application and Theory of Petri Nets and Concurrency (PETRI NETS 2026), LNCS vol. 16567, pp. 395–405. Springer, Cham, 2026.';

const BIBTEX = `@inproceedings{koren2026ocpnstudio,
  author    = {Koren, Istv{\\'a}n},
  title     = {{OCPN} Studio: Web-Based Modeling, Simulation, and Analysis of Object-Centric {P}etri Nets},
  booktitle = {Application and Theory of Petri Nets and Concurrency},
  editor    = {Desel, J{\\"o}rg and Kalenkova, Anna},
  series    = {Lecture Notes in Computer Science},
  volume    = {16567},
  pages     = {395--405},
  publisher = {Springer},
  address   = {Cham},
  year      = {2026},
  doi       = {10.1007/978-3-032-27879-1_21}
}`;

function MenuButton({ item, onSelect }: { item: { key: DialogKey; label: string; icon: typeof Info }; onSelect: (key: DialogKey) => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.key)}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent transition-colors"
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      {item.label}
    </button>
  );
}

export function AboutLegalMenu() {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [openDialog, setOpenDialog] = useState<DialogKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    const lastSeenVersion = localStorage.getItem(LAST_SEEN_VERSION_KEY);
    return lastSeenVersion !== pkg.version && !!RELEASE_HIGHLIGHTS[pkg.version];
  });

  const handleWelcomeOpenChange = (open: boolean) => {
    setWelcomeOpen(open);
    if (!open) {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, pkg.version);
    }
  };

  const openWelcome = () => {
    setPopoverOpen(false);
    setWelcomeOpen(true);
  };

  const selectItem = (key: DialogKey) => {
    setPopoverOpen(false);
    setOpenDialog(key);
  };

  const copyBibtex = async () => {
    await navigator.clipboard.writeText(BIBTEX);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Info className="h-4.5 w-4.5" />
            About &amp; Legal
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} className="w-64 p-0 overflow-hidden">
          <PopoverPrimitive.Arrow className="fill-popover" width={14} height={7} />
          <button
            type="button"
            onClick={openWelcome}
            className="w-full px-3 py-2.5 border-b flex items-baseline justify-between hover:bg-accent transition-colors text-left"
          >
            <span className="font-semibold text-sm">OCPN Studio</span>
            <span className="text-xs text-muted-foreground">v{pkg.version}</span>
          </button>
          <div className="py-1">
            {PRIMARY_ITEMS.map((item) => (
              <MenuButton key={item.key} item={item} onSelect={selectItem} />
            ))}
          </div>
          <div className="py-1 border-t">
            {LEGAL_ITEMS.map((item) => (
              <MenuButton key={item.key} item={item} onSelect={selectItem} />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <WelcomeSplashDialog open={welcomeOpen} onOpenChange={handleWelcomeOpenChange} />

      {/* About */}
      <Dialog open={openDialog === "about"} onOpenChange={(o) => !o && setOpenDialog(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>About OCPN Studio</DialogTitle>
          </DialogHeader>
          <DialogDescription className="text-sm text-foreground">
            OCPN Studio is a modern web application for designing Object-centric Colored Petri Nets
            (OCPNs) and generating simulated OCEL 2.0 event logs — making what used to be a complex,
            StandardML-heavy workflow super easy and smooth, right in your browser.
          </DialogDescription>
          <p className="text-xs text-muted-foreground">
            Version {pkg.version} ·{" "}
            <a
              href="https://github.com/ELTE-DSED/ocpn-studio"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 underline hover:text-foreground"
            >
              Source on GitHub <ExternalLink className="h-3 w-3" />
            </a>
          </p>
        </DialogContent>
      </Dialog>

      {/* Changelog */}
      <Dialog open={openDialog === "changelog"} onOpenChange={(o) => !o && setOpenDialog(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Changelog</DialogTitle>
            <DialogDescription>The biggest milestones so far.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">Latest · July 2026</p>
              <p className="text-xs text-muted-foreground">
                Added Declare constraints — declarative behavioral rules drawn as arcs between
                transitions or attached to a single transition — plus a redesigned interface.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold">v0.5 · March 2026</p>
              <p className="text-xs text-muted-foreground">
                Added the Analysis tab: state-space exploration, monitors, and performance reports.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold">v0.4 · March 2026</p>
              <p className="text-xs text-muted-foreground">
                Visual modeling and step/run simulation of Object-Centric Petri Nets — Model and
                Simulation only.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cite this Tool */}
      <Dialog open={openDialog === "cite"} onOpenChange={(o) => !o && setOpenDialog(null)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Cite this Tool</DialogTitle>
            <DialogDescription>
              If OCPN Studio was useful for your research, please cite the paper introducing it.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">{CITATION_TEXT}</p>
          <div className="relative">
            <pre className="text-xs font-mono bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
              {BIBTEX}
            </pre>
            <Button
              size="sm"
              variant="outline"
              className="absolute top-2 right-2 h-7"
              onClick={copyBibtex}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Imprint */}
      <Dialog open={openDialog === "imprint"} onOpenChange={(o) => !o && setOpenDialog(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Imprint</DialogTitle>
          </DialogHeader>
          <div className="text-sm space-y-1">
            <p>Eötvös Loránd University (ELTE)</p>
            <p>Faculty of Informatics</p>
            <p>Department of Data Science and Engineering</p>
            <p>Pázmány Péter sétány 1/A</p>
            <p>1117 Budapest, Hungary</p>
          </div>
          <p className="text-xs text-muted-foreground">Responsible for content: István Koren</p>
        </DialogContent>
      </Dialog>

      {/* Licenses */}
      <Dialog open={openDialog === "licenses"} onOpenChange={(o) => !o && setOpenDialog(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Licenses</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">OCPN Studio (this web app)</p>
              <p className="text-xs text-muted-foreground">
                MIT License. Copyright (c) 2025-2026 RWTH Aachen University, Chair of Process and
                Data Science, István Koren.
              </p>
            </div>
            <div>
              <p className="text-sm font-semibold">cpnsim (simulation engine)</p>
              <p className="text-xs text-muted-foreground">
                MIT License. Copyright (c) 2025-2026 RWTH Aachen University, Chair of Process and
                Data Science, István Koren.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Contact */}
      <Dialog open={openDialog === "contact"} onOpenChange={(o) => !o && setOpenDialog(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Contact</DialogTitle>
          </DialogHeader>
          <div className="text-sm space-y-3">
            <p>Proudly developed in Budapest by István Koren.</p>
            <p>
              Have feedback? Please use the <strong>Feedback</strong> button in the top-right corner
              of the app.
            </p>
            <p>
              I'm also always happy to hear about opportunities for collaboration and joint research
              — feel free to reach out the same way.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
