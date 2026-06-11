/**
 * Pure-CSS ambient field — three soft radial gradients in the corners.
 * Pulled from the Haven Home design. Pure visual, no JS, no listeners.
 *
 * Sits behind everything (pointer-events: none, z-index: 0) and only
 * renders meaningful color when the Aura theme is active because the
 * gradient swatches (--aura-violet / blue / peach) are defined under
 * [data-theme="aura"] in globals.css. Under Terminal the swatches
 * collapse to transparent and this becomes a no-op div.
 *
 * `dim` softens the field for the reading state (in-chat). The
 * transition is long + eased so the shift feels like the room dimming,
 * not a snap.
 */
interface HavenAuraProps {
  dim?: boolean;
}

export default function HavenAura({ dim = false }: HavenAuraProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        opacity: dim ? 0.32 : 1,
        transition: 'opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1)',
        background:
          'radial-gradient(1000px 640px at 16% -12%, var(--aura-violet, transparent), transparent 62%), ' +
          'radial-gradient(880px 620px at 88% 12%, var(--aura-blue, transparent), transparent 60%), ' +
          'radial-gradient(1000px 720px at 68% 108%, var(--aura-peach, transparent), transparent 62%)',
      }}
    />
  );
}
