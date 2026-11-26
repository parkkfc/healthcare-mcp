import { useEffect } from "react";
import { useModelContext } from "skybridge/web";

// Slider and form state for the model. audience assistant keeps it out of the chat.
// Debounced so each keystroke does not ping the host and pull the page down.
export function useAssistantContext(summary: string) {
  const { supported, update } = useModelContext();
  useEffect(() => {
    if (!supported || summary.length === 0) return;
    const timer = window.setTimeout(() => {
      void update({
        content: [
          {
            type: "text",
            text: summary,
            annotations: { audience: ["assistant"] },
          },
        ],
      }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [summary, supported, update]);
}
