import { useState, useRef, useContext } from "react";
import HCaptcha from "@hcaptcha/react-hcaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import useStore from "@/stores/store";
import { convertToJSON, type PetriNetData } from "@/utils/FileOperations";
import { SimulationContext } from "@/context/useSimulationContextHook";

const WEB3FORMS_ACCESS_KEY = "107df1fd-0a94-4781-ac95-0689be476e62";
const HCAPTCHA_SITEKEY = "50b2fe65-b00b-4b9e-ad62-3ba471098be2";

type FeedbackCategory = "feature-request" | "bug-report" | "help-other";

const categoryLabels: Record<FeedbackCategory, string> = {
  "feature-request": "Feature Request",
  "bug-report": "Bug Report",
  "help-other": "Help / Other",
};

const categoryPlaceholders: Record<FeedbackCategory, string> = {
  "feature-request":
    "Describe the feature you'd like to see. What problem does it solve? How would you use it?",
  "bug-report":
    "What happened? What did you expect to happen? Steps to reproduce the issue…",
  "help-other":
    "What do you need help with? Describe your question or challenge…",
};

interface FeedbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const [category, setCategory] = useState<FeedbackCategory>("feature-request");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [includeModel, setIncludeModel] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "sending" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const captchaRef = useRef<HCaptcha>(null);

  const simulationContext = useContext(SimulationContext);

  const resetForm = () => {
    setCategory("feature-request");
    setMessage("");
    setEmail("");
    setIncludeModel(false);
    setCaptchaToken(null);
    setStatus("idle");
    setErrorMessage("");
    captchaRef.current?.resetCaptcha();
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Only reset if closing after success, otherwise keep state
      if (status === "success") {
        resetForm();
      }
    }
    onOpenChange(newOpen);
  };

  const getModelSnapshot = (): string | null => {
    try {
      const state = useStore.getState();
      const petriNetData: PetriNetData = {
        petriNetsById: state.petriNetsById,
        petriNetOrder: state.petriNetOrder,
        colorSets: state.colorSets,
        variables: state.variables,
        priorities: state.priorities,
        functions: state.functions,
        uses: state.uses,
        values: state.values,
        simulationSettings: {
          stepsPerRun: simulationContext?.simulationConfig?.stepsPerRun,
          animationDelayMs:
            simulationContext?.simulationConfig?.animationDelayMs,
          simulationEpoch: state.simulationEpoch,
        },
      };
      return convertToJSON(petriNetData);
    } catch {
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!captchaToken) {
      setErrorMessage("Please complete the captcha verification.");
      return;
    }

    if (!message.trim()) {
      setErrorMessage("Please enter a message.");
      return;
    }

    setStatus("sending");
    setErrorMessage("");

    try {
      const formData = new FormData();
      formData.append("access_key", WEB3FORMS_ACCESS_KEY);
      formData.append("subject", `OCPN Studio Feedback: ${categoryLabels[category]}`);
      formData.append("from_name", "OCPN Studio Feedback");
      formData.append("category", categoryLabels[category]);
      formData.append("message", message);
      formData.append("h-captcha-response", captchaToken);

      if (email.trim()) {
        formData.append("email", email);
        formData.append("replyto", email);
      } else {
        formData.append("email", "noreply@ocpn-studio.feedback");
      }

      if (includeModel) {
        const modelJson = getModelSnapshot();
        if (modelJson) {
          // Truncate if needed (Web3Forms has limits)
          const truncated =
            modelJson.length > 50000
              ? modelJson.substring(0, 50000) + "\n... (truncated)"
              : modelJson;
          formData.append("petri_net_model", truncated);
        }
      }

      const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMessage(data.message || "Something went wrong. Please try again.");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Network error. Please check your connection and try again.");
    }
  };

  const handleCaptchaVerify = (token: string) => {
    setCaptchaToken(token);
    setErrorMessage("");
  };

  const handleCaptchaExpire = () => {
    setCaptchaToken(null);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Send Feedback</DialogTitle>
          <DialogDescription>
            Help us improve OCPN Studio. Your feedback is greatly appreciated!
          </DialogDescription>
        </DialogHeader>

        {status === "success" ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
            <p className="text-center text-lg font-medium">
              Thank you for your feedback!
            </p>
            <p className="text-center text-sm text-muted-foreground">
              We appreciate you taking the time to help us improve.
            </p>
            <Button onClick={() => { resetForm(); onOpenChange(false); }}>
              Close
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Category Selection */}
            <div className="space-y-2">
              <Label>Category</Label>
              <RadioGroup
                value={category}
                onValueChange={(val) => setCategory(val as FeedbackCategory)}
                className="flex flex-row gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="feature-request" id="cat-feature" />
                  <Label htmlFor="cat-feature" className="font-normal cursor-pointer">
                    Feature Request
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="bug-report" id="cat-bug" />
                  <Label htmlFor="cat-bug" className="font-normal cursor-pointer">
                    Bug Report
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="help-other" id="cat-help" />
                  <Label htmlFor="cat-help" className="font-normal cursor-pointer">
                    Help / Other
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea
                id="feedback-message"
                placeholder={categoryPlaceholders[category]}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[120px] resize-y"
                required
              />
            </div>

            {/* Email (optional) */}
            <div className="space-y-2">
              <Label htmlFor="feedback-email">
                Email{" "}
                <span className="text-muted-foreground font-normal">
                  (optional — if you'd like a reply)
                </span>
              </Label>
              <Input
                id="feedback-email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {/* Include Petri Net checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="include-model"
                checked={includeModel}
                onCheckedChange={(checked) =>
                  setIncludeModel(checked === true)
                }
              />
              <Label
                htmlFor="include-model"
                className="font-normal cursor-pointer text-sm"
              >
                Include the currently loaded Petri Net and its simulation state
              </Label>
            </div>

            {/* hCaptcha */}
            <div className="flex justify-center">
              <HCaptcha
                ref={captchaRef}
                sitekey={HCAPTCHA_SITEKEY}
                reCaptchaCompat={false}
                onVerify={handleCaptchaVerify}
                onExpire={handleCaptchaExpire}
              />
            </div>

            {/* Error message */}
            {errorMessage && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errorMessage}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={status === "sending"}>
                {status === "sending" ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Send Feedback"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
