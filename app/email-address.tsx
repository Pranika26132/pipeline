// An email address that can wrap at the "@" on a narrow screen.
export function EmailAddress({ address }: { address: string }) {
  const at = address.lastIndexOf("@");
  const part = "inline-block max-w-full wrap-anywhere";
  if (at <= 0) {
    return <span className={`font-semibold text-foreground ${part}`}>{address}</span>;
  }
  return (
    <span className={`font-semibold text-foreground ${part}`}>
      <span className={part}>{address.slice(0, at)}</span>
      <wbr />
      <span className={part}>{address.slice(at)}</span>
    </span>
  );
}
