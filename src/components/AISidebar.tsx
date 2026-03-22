import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Send, Settings } from "lucide-react"
import { cn } from "@/lib/utils";



import { SettingsDialog } from '@/components/dialogs/SettingsDialog';

import useStore from '@/stores/store';
import { PetriNetData, convertToJSON } from '@/utils/FileOperations';

interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: Date
}

// Local storage key for OpenAI API key
const OPENAI_API_KEY_STORAGE_KEY = "ocpn-studio-openai-api-key";

export function AISidebar() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I'm Carl, your OCPN assistant. I can help you analyze your model, explain concepts, or suggest improvements. What would you like to know?",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [apiKey, setApiKey] = useState<string | null>(null)

  // Load API key from local storage
  useEffect(() => {
    const storedApiKey = localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY)
    if (storedApiKey) {
      setApiKey(storedApiKey)
    }
  }, [])

  const handleApiKeyChange = (newApiKey: string) => {
    setApiKey(newApiKey)
    localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, newApiKey)
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const generatePetriNetDescription = () => {
    const petriNetData: PetriNetData = {
      petriNetsById: useStore.getState().petriNetsById,
      petriNetOrder: useStore.getState().petriNetOrder,
      colorSets: useStore.getState().colorSets,
      variables: useStore.getState().variables,
      priorities: useStore.getState().priorities,
      functions: useStore.getState().functions,
      uses: useStore.getState().uses,
      values: useStore.getState().values,
    }
    const petriNetJSON = convertToJSON(petriNetData);

    return `
      Here is the current state of the Petri Net:

      ${petriNetJSON}
    `;

    // const placeCount = nodes.filter((node) => node.type === "place").length
    // const transitionCount = nodes.filter((node) => node.type === "transition").length
    // const arcCount = edges.length

    // return `
    //   The current Petri Net model has ${placeCount} places, ${transitionCount} transitions, and ${arcCount} arcs.

    //   Places:
    //   ${nodes
    //     .filter((node) => node.type === "place")
    //     .map(
    //       (node) =>
    //         `- ${node.data.label}: ColorSet=${node.data.colorSet}, InitialMarking=${
    //           node.data.initialMarking || "empty"
    //         }`,
    //     )
    //     .join("\n")}

    //   Transitions:
    //   ${nodes
    //     .filter((node) => node.type === "transition")
    //     .map(
    //       (node) =>
    //         `- ${node.data.label}${node.data.guard ? `, Guard=[${node.data.guard}]` : ""}${
    //           node.data.time ? `, Time=${node.data.time}` : ""
    //         }${node.data.priority ? `, Priority=${node.data.priority}` : ""}`,
    //     )
    //     .join("\n")}

    //   Color Sets:
    //   ${colorSets.map((cs) => `- ${cs.name}: ${cs.definition}`).join("\n")}

    //   Variables:
    //   ${variables.map((v) => `- ${v.name}: ${v.colorSet}`).join("\n")}

    //   Functions:
    //   ${functions.map((f) => `- ${f.name}`).join("\n")}
    // `
  }

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return
    if (!apiKey) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "user",
          content: input,
          timestamp: new Date(),
        },
        {
          id: Date.now().toString() + "-error",
          role: "assistant",
          content:
            "Please set your OpenAI API key in the settings to use the AI assistant. Click the settings icon in the top right corner.",
          timestamp: new Date(),
        },
      ])
      setInput("")
      return
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    try {
      // Generate a description of the current Petri Net
      const petriNetDescription = generatePetriNetDescription()

      // Prepare the conversation input for the Responses API
      const inputMessages = [
        ...messages
          .filter((msg) => msg.id !== "welcome") // Skip the welcome message
          .map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        {
          role: userMessage.role,
          content: userMessage.content,
        },
      ]

      // Call OpenAI Responses API
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          instructions: `You are an AI assistant specialized in Colored Petri Nets (CPN). 
Help the user understand and analyze their Petri Net model.
Here is the current state of the Petri Net:

${petriNetDescription}

Be concise but informative in your responses. If asked about concepts, explain them clearly.
If asked to analyze the model, provide insights based on the structure and properties.`,
          input: inputMessages,
          max_output_tokens: 4096,
          store: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const errorMsg = errorData?.error?.message || `HTTP ${response.status}`
        throw new Error(errorMsg)
      }

      const data = await response.json()
      // Extract text from the output array (output_text is only in the SDK)
      const outputText = data.output
        ?.filter((item: { type: string }) => item.type === "message")
        .flatMap((item: { content: { type: string; text: string }[] }) => item.content)
        .filter((c: { type: string }) => c.type === "output_text")
        .map((c: { text: string }) => c.text)
        .join("") || "No response generated."
      const assistantMessage = {
        id: Date.now().toString() + "-response",
        role: "assistant" as const,
        content: outputText,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error("Error calling OpenAI API:", error)
      const errorMessage = error instanceof Error ? error.message : "Unknown error"
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString() + "-error",
          role: "assistant",
          content: `Error: ${errorMessage}`,
          timestamp: new Date(),
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="border-l h-screen w-[400px] shrink-0 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center">
            {/* <Sparkles className="h-5 w-5 text-primary mr-2" /> */}
            <h2 className="font-semibold">OCPN AI Assistant</h2>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 p-4">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col max-w-[90%] rounded-lg p-3",
                  message.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted text-foreground",
                )}
              >
                <div className="whitespace-pre-wrap">{message.content}</div>
                <div className="text-xs opacity-70 mt-1 self-end">
                  {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex max-w-[90%] rounded-lg p-3 bg-muted text-foreground">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 rounded-full bg-foreground/50 animate-bounce" />
                  <div
                    className="w-2 h-2 rounded-full bg-foreground/50 animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  />
                  <div
                    className="w-2 h-2 rounded-full bg-foreground/50 animate-bounce"
                    style={{ animationDelay: "0.4s" }}
                  />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <Separator />

        <div className="p-4">
          <div className="flex items-center space-x-2">
            <Input
              placeholder="Ask about your OCPN…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading || !apiKey}
              className="flex-1"
            />
            <Button size="icon" onClick={handleSendMessage} disabled={isLoading || !input.trim() || !apiKey}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
          {!apiKey && (
            <p className="text-xs text-muted-foreground mt-2">
              Please set your OpenAI API key in settings to use the AI assistant.
            </p>
          )}
        </div>

      
      <SettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        apiKey={apiKey}
        onApiKeyChange={handleApiKeyChange}
      />
    </div>
  )
}
