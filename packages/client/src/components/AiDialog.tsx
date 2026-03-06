import React, { useEffect, useRef, useState } from "react";

export type AiAction = "repair" | "remix" | "predict";

interface AiDialogProps {
  action: AiAction | null;
  onSubmit: (action: AiAction, userMessage: string) => void;
  onCancel: () => void;
}

const placeholders: Record<AiAction, string> = {
  repair: "e.g., Focus on the top-left box\u2026",
  remix: "e.g., Arrange everything in a grid\u2026",
  predict: "e.g., Add a footer section\u2026",
};

export function AiDialog({ action, onSubmit, onCancel }: AiDialogProps) {
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (action !== null) {
      setMessage("");
      if (!dialog.open) dialog.showModal();
      // Focus textarea after modal opens
      setTimeout(() => textareaRef.current?.focus(), 0);
    } else {
      if (dialog.open) dialog.close();
    }
  }, [action]);

  // Handle backdrop click and Escape key
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) onCancel();
    };
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };

    dialog.addEventListener("click", handleClick);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("click", handleClick);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [onCancel]);

  return (
    <dialog ref={dialogRef} className="ai-dialog-backdrop">
      <div className="ai-dialog-popup">
        <div className="ai-dialog-title">
          {action ? action.charAt(0).toUpperCase() + action.slice(1) : ""}
        </div>
        <div className="ai-dialog-description">
          Optional: add instructions for the AI.
        </div>
        <textarea
          ref={textareaRef}
          className="ai-dialog-textarea"
          placeholder={action ? placeholders[action] : ""}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
        />
        <div className="ai-dialog-actions">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn ai-dialog-submit"
            onClick={() => {
              if (action) {
                onSubmit(action, message.trim());
              }
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </dialog>
  );
}
