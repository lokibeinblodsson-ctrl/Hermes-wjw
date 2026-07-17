import { useState, InputHTMLAttributes } from "react";

// Password input with an inline show/hide toggle. Accessible: the toggle
// button exposes an aria-label that updates with state. Borderless, sits
// inside the input on the right, subtle hover — matches the calm dark theme.
export default function PasswordField(props: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const { label, className, style, ...rest } = props;
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input
        {...rest}
        type={show ? "text" : "password"}
        style={{ ...style, width: "100%", paddingRight: 38 }}
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        onClick={() => setShow((s) => !s)}
        className="pw-toggle"
        tabIndex={-1}
      >
        {show ? eyeOff : eyeOn}
      </button>
    </div>
  );
}

// Inline SVG icons (no icon-library dependency).
const eyeOn = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const eyeOff = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);
