import React from "react";

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder }: SelectProps) {
  return (
    <select
      className="select-trigger"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}
