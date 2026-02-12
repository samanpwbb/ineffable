import { Select as BaseSelect } from "@base-ui/react/select";
import React from "react";

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder }: SelectProps) {
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => { if (v != null) onChange(v); }}>
      <BaseSelect.Trigger className="select-trigger">
        <BaseSelect.Value placeholder={placeholder ?? "Select..."} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="select-positioner">
          <BaseSelect.Popup className="select-popup">
            {options.map((opt) => (
              <BaseSelect.Item
                key={opt.value}
                value={opt.value}
                className="select-item"
              >
                <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
