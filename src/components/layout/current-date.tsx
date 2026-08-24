"use client";

export function CurrentDate() {
  const now = new Date();
  const label = new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  return (
    <time dateTime={now.toISOString()} suppressHydrationWarning>
      {label}
    </time>
  );
}
