import { Button as BaseButton } from "@base-ui/react/button";
import React from "react";

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function Button({ children, onClick, disabled, className }: ButtonProps) {
  return (
    <BaseButton
      className={`btn${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </BaseButton>
  );
}
