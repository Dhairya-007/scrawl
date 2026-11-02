import { AVATAR_COLORS, type Avatar } from '@scrawl/shared';

/**
 * Avatars are assembled from plain SVG primitives: an outline, a pair of eyes,
 * a mouth and an optional hat. Five small numbers therefore describe a face,
 * and nothing has to be downloaded.
 */

const INK = '#120828';

/** Head outlines, all filling roughly the same box so hats line up. */
function Head({ shape, fill }: { shape: number; fill: string }) {
  const common = { fill, stroke: INK, strokeWidth: 5 } as const;
  switch (shape % 4) {
    case 1:
      // Rounded square.
      return <rect x="16" y="20" width="68" height="64" rx="20" {...common} />;
    case 2:
      // Egg: narrower at the top.
      return <ellipse cx="50" cy="54" rx="30" ry="34" {...common} />;
    case 3:
      // Blob, with one side bulging.
      return (
        <path
          d="M50 20c20 0 34 12 34 30 0 22-14 34-34 34S14 70 14 50c0-8 4-15 10-21 6-6 16-9 26-9Z"
          {...common}
        />
      );
    default:
      return <circle cx="50" cy="52" r="32" {...common} />;
  }
}

function Eyes({ style }: { style: number }) {
  const left = 38;
  const right = 62;
  const y = 46;

  switch (style % 8) {
    case 1:
      // Wide open, with a highlight.
      return (
        <g>
          {[left, right].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={y} rx="8" ry="9" fill="#fff" stroke={INK} strokeWidth="3.5" />
              <circle cx={x + 1.5} cy={y + 1.5} r="4" fill={INK} />
              <circle cx={x - 1.5} cy={y - 2.5} r="1.6" fill="#fff" />
            </g>
          ))}
        </g>
      );
    case 2:
      // Sleepy: closed curves.
      return (
        <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round">
          <path d={`M${left - 7} ${y} q7 7 14 0`} />
          <path d={`M${right - 7} ${y} q7 7 14 0`} />
        </g>
      );
    case 3:
      // Rings.
      return (
        <g fill="none" stroke={INK} strokeWidth="4">
          <circle cx={left} cy={y} r="7" />
          <circle cx={right} cy={y} r="7" />
        </g>
      );
    case 4:
      // Starry.
      return (
        <g stroke={INK} strokeWidth="3.5" strokeLinecap="round">
          {[left, right].map((x) => (
            <g key={x}>
              <line x1={x - 6} y1={y} x2={x + 6} y2={y} />
              <line x1={x} y1={y - 6} x2={x} y2={y + 6} />
              <line x1={x - 4} y1={y - 4} x2={x + 4} y2={y + 4} />
              <line x1={x - 4} y1={y + 4} x2={x + 4} y2={y - 4} />
            </g>
          ))}
        </g>
      );
    case 5:
      // Half-moons, looking off to one side.
      return (
        <g>
          {[left, right].map((x) => (
            <g key={x}>
              <circle cx={x} cy={y} r="8" fill="#fff" stroke={INK} strokeWidth="3.5" />
              <circle cx={x + 3} cy={y} r="3.6" fill={INK} />
            </g>
          ))}
        </g>
      );
    case 6:
      // Determined slants.
      return (
        <g stroke={INK} strokeWidth="5" strokeLinecap="round">
          <line x1={left - 7} y1={y - 5} x2={left + 7} y2={y + 1} />
          <line x1={right - 7} y1={y + 1} x2={right + 7} y2={y - 5} />
        </g>
      );
    case 7:
      // One raised brow.
      return (
        <g>
          <circle cx={left} cy={y} r="5" fill={INK} />
          <circle cx={right} cy={y} r="5" fill={INK} />
          <path
            d={`M${right - 8} ${y - 11} q8 -5 16 -1`}
            fill="none"
            stroke={INK}
            strokeWidth="4"
            strokeLinecap="round"
          />
        </g>
      );
    default:
      return (
        <g fill={INK}>
          <circle cx={left} cy={y} r="5.5" />
          <circle cx={right} cy={y} r="5.5" />
        </g>
      );
  }
}

function Mouth({ style }: { style: number }) {
  const stroke = { fill: 'none', stroke: INK, strokeWidth: 4.5, strokeLinecap: 'round' } as const;

  switch (style % 8) {
    case 1:
      // Big grin showing teeth.
      return (
        <g>
          <path d="M34 62 q16 18 32 0 Z" fill={INK} />
          <path d="M40 64 h20" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    case 2:
      // Small surprised circle.
      return <circle cx="50" cy="66" r="6" fill={INK} />;
    case 3:
      return <path d="M38 66 h24" {...stroke} />;
    case 4:
      // Zigzag.
      return <path d="M36 64 l6 5 l6 -5 l6 5 l6 -5" {...stroke} />;
    case 5:
      // Tongue out.
      return (
        <g>
          <path d="M36 62 q14 14 28 0" {...stroke} />
          <path d="M46 68 q4 10 8 0 Z" fill="#ff6b9d" stroke={INK} strokeWidth="3" />
        </g>
      );
    case 6:
      return <path d="M38 70 q12 -12 24 0" {...stroke} />;
    case 7:
      // Open laugh.
      return <ellipse cx="50" cy="66" rx="11" ry="8" fill={INK} />;
    default:
      return <path d="M38 62 q12 12 24 0" {...stroke} />;
  }
}

function Hat({ style, color }: { style: number; color: string }) {
  switch (style % 7) {
    case 1:
      // Beanie with a bobble.
      return (
        <g stroke={INK} strokeWidth="4.5">
          <path d="M20 26 q30 -24 60 0 Z" fill={color} />
          <rect x="18" y="24" width="64" height="9" rx="4.5" fill="#fff8ec" />
          <circle cx="50" cy="8" r="7" fill={color} />
        </g>
      );
    case 2:
      // Cap with a peak.
      return (
        <g stroke={INK} strokeWidth="4.5">
          <path d="M22 28 q28 -26 56 -2 Z" fill={color} />
          <path d="M74 26 q18 2 16 12 l-20 -2 Z" fill={color} />
        </g>
      );
    case 3:
      // Crown.
      return (
        <path
          d="M24 28 l4 -20 12 10 10 -16 10 16 12 -10 4 20 Z"
          fill="#ffcc00"
          stroke={INK}
          strokeWidth="4.5"
        />
      );
    case 4:
      // Party cone.
      return (
        <g stroke={INK} strokeWidth="4.5">
          <path d="M50 0 L70 28 H30 Z" fill={color} />
          <circle cx="50" cy="2" r="5" fill="#fff8ec" />
        </g>
      );
    case 5:
      // Bow.
      return (
        <g stroke={INK} strokeWidth="4">
          <path d="M50 22 L30 12 v20 Z" fill={color} />
          <path d="M50 22 L70 12 v20 Z" fill={color} />
          <circle cx="50" cy="22" r="5" fill="#fff8ec" />
        </g>
      );
    case 6:
      // Headphones.
      return (
        <g stroke={INK} strokeWidth="5" fill="none">
          <path d="M18 50 Q18 14 50 14 Q82 14 82 50" />
          <rect x="8" y="44" width="16" height="24" rx="7" fill={color} />
          <rect x="76" y="44" width="16" height="24" rx="7" fill={color} />
        </g>
      );
    default:
      return null;
  }
}

export function AvatarFace({
  avatar,
  className = '',
  title,
}: {
  avatar: Avatar;
  className?: string;
  title?: string;
}) {
  const color = AVATAR_COLORS[avatar.color % AVATAR_COLORS.length]!;
  return (
    <svg
      viewBox="-4 -4 108 100"
      className={className}
      role="img"
      aria-label={title ?? 'Player avatar'}
    >
      {title && <title>{title}</title>}
      <Head shape={avatar.face} fill={color} />
      <Eyes style={avatar.eyes} />
      <Mouth style={avatar.mouth} />
      <Hat style={avatar.hat} color={color} />
    </svg>
  );
}
