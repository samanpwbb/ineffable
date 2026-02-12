import { Dialog } from "@base-ui/react/dialog";
import React, { useEffect, useState } from "react";

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

  useEffect(() => {
    if (action !== null) setMessage("");
  }, [action]);

  const open = action !== null;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
      modal
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ai-dialog-backdrop" />
        <Dialog.Popup className="ai-dialog-popup">
          <Dialog.Title className="ai-dialog-title">
            {action ? action.charAt(0).toUpperCase() + action.slice(1) : ""}
          </Dialog.Title>
          <Dialog.Description className="ai-dialog-description">
            Optional: add instructions for the AI.
          </Dialog.Description>
          <textarea
            className="ai-dialog-textarea"
            placeholder={action ? placeholders[action] : ""}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="ai-dialog-actions">
            <button
              className="btn"
              onClick={onCancel}
            >
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
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
