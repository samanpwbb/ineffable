import { useEffect, useState } from "react";
import { AppDialog } from "./AppDialog.js";

interface NewFileDialogProps {
  open: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function NewFileDialog({ open, onSubmit, onCancel }: NewFileDialogProps) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <AppDialog
      open={open}
      onClose={onCancel}
      title="New File"
      description="Enter a name for the new file."
      actions={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn ai-dialog-submit"
            onClick={handleSubmit}
            disabled={!name.trim()}
          >
            Create
          </button>
        </>
      }
    >
      <input
        className="ai-dialog-textarea"
        placeholder="filename.txt"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
        autoFocus
      />
    </AppDialog>
  );
}
