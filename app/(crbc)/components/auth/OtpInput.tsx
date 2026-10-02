"use client";

export const OTP_LENGTH = 6;

/** OTP must be exactly 6 digits, 0-9 only. No letters, symbols or spaces. */
export const OTP_PATTERN = /^[0-9]{6}$/;

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
};

export default function OtpInput({
  value,
  onChange,
  disabled,
  autoFocus = true,
  label = "6-digit verification code",
}: Props) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={OTP_LENGTH}
      value={value}
      disabled={disabled}
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      aria-label={label}
      placeholder="000000"
      onChange={(e) => {
        // Strip everything that is not 0-9, then cap at 6 digits.
        onChange(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
      }}
      className="w-full h-14 text-center text-2xl tracking-[0.5em] font-mono rounded-lg border border-line bg-background text-foreground focus:border-accent focus:ring-2 focus:ring-accent/15 outline-none disabled:opacity-60"
    />
  );
}
