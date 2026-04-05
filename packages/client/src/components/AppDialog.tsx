import { Dialog } from "@base-ui/react/dialog";
import React from "react";

interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  actions: React.ReactNode;
}

export function AppDialog({ open, onClose, title, description, children, actions }: AppDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      modal
      disablePointerDismissal
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="ai-dialog-backdrop" onClick={onClose} />
        <Dialog.Popup className="ai-dialog-popup">
          <Dialog.Title className="ai-dialog-title">{title}</Dialog.Title>
          {description && (
            <Dialog.Description className="ai-dialog-description">
              {description}
            </Dialog.Description>
          )}
          {children}
          <div className="ai-dialog-actions">{actions}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
