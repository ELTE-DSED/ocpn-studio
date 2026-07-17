import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Coffee, HelpCircle, MessageSquarePlus, Sparkles } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

import { HelpDialog } from '@/components/dialogs/HelpDialog';
import { FeedbackDialog } from '@/components/dialogs/FeedbackDialog';
import { SupportDialog } from '@/components/dialogs/SupportDialog';

export function AssistanceToolbar({ onToggleAIAssistant }: { onToggleAIAssistant: () => void }) {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" onClick={() => setIsHelpOpen(true)}>
                <HelpCircle className="h-5 w-5" />
                <span className="sr-only">Help & Documentation</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Help & Documentation</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" onClick={() => setIsFeedbackOpen(true)}>
                <MessageSquarePlus className="h-5 w-5" />
                <span className="sr-only">Send Feedback</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Send Feedback</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" onClick={() => setIsSupportOpen(true)}>
                <Coffee className="h-5 w-5" />
                <span className="sr-only">Buy Me a Coffee</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Buy Me a Coffee</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" onClick={onToggleAIAssistant}>
                <Sparkles className="h-5 w-5" />
                <span className="sr-only">Toggle AI Assistant</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>Toggle AI Assistant</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <HelpDialog open={isHelpOpen} onOpenChange={setIsHelpOpen} />
      <FeedbackDialog open={isFeedbackOpen} onOpenChange={setIsFeedbackOpen} />
      <SupportDialog open={isSupportOpen} onOpenChange={setIsSupportOpen} />
    </div>
  );
};
