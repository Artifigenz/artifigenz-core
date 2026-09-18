/**
 * Non-clickable "Coming soon" status pill that replaces the primary CTA on the
 * public landing page while the product is in invite-only preview. Direct
 * access to /sign-in, /sign-up, /app, and /agent/* remains available.
 */

export default function ComingSoonBadge() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 22px',
        borderRadius: '9999px',
        border: '1px solid color-mix(in srgb, currentColor, transparent 75%)',
        color: 'currentColor',
        fontSize: '0.92rem',
        fontWeight: 500,
        letterSpacing: '-0.005em',
        userSelect: 'none',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      aria-label="Coming soon"
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: 'currentColor',
          opacity: 0.55,
        }}
        aria-hidden="true"
      />
      Coming soon
    </span>
  );
}
