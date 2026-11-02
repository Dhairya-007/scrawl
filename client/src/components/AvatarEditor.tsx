import { AVATAR_COLORS, AVATAR_COUNTS, randomAvatar, type Avatar } from '@scrawl/shared';
import { AvatarFace } from './AvatarFace.js';
import { Button } from './ui.js';

type Part = keyof typeof AVATAR_COUNTS;

const PARTS: Array<{ key: Part; label: string }> = [
  { key: 'face', label: 'Head' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'mouth', label: 'Mouth' },
  { key: 'hat', label: 'Hat' },
];

/** Step one part of the face, wrapping round at either end. */
function step(avatar: Avatar, part: Part, delta: number): Avatar {
  const count = AVATAR_COUNTS[part];
  return { ...avatar, [part]: (avatar[part] + delta + count) % count };
}

export function AvatarEditor({
  avatar,
  onChange,
}: {
  avatar: Avatar;
  onChange: (next: Avatar) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <div className="panel-bright bg-chalk p-2">
          <AvatarFace avatar={avatar} className="h-28 w-28" title="Your avatar" />
        </div>
        <Button
          tone="grape"
          size="sm"
          className="absolute -right-3 -bottom-3"
          onClick={() => onChange(randomAvatar())}
          aria-label="Shuffle avatar"
          title="Shuffle"
        >
          🎲
        </Button>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5">
        {AVATAR_COLORS.map((color, index) => (
          <button
            key={color}
            type="button"
            aria-label={`Colour ${index + 1}`}
            aria-pressed={avatar.color === index}
            onClick={() => onChange({ ...avatar, color: index })}
            className={`h-7 w-7 rounded-full border-[3px] transition-transform ${
              avatar.color === index
                ? 'scale-115 border-sun'
                : 'border-ink hover:scale-110'
            }`}
            style={{ background: color }}
          />
        ))}
      </div>

      <div className="grid w-full grid-cols-2 gap-2">
        {PARTS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-1 rounded-xl border-[3px] border-ink bg-night-800 px-2 py-1">
            <button
              type="button"
              className="px-1 font-display text-xl text-sun"
              aria-label={`Previous ${label}`}
              onClick={() => onChange(step(avatar, key, -1))}
            >
              ‹
            </button>
            <span className="font-display text-sm text-chalk/80">{label}</span>
            <button
              type="button"
              className="px-1 font-display text-xl text-sun"
              aria-label={`Next ${label}`}
              onClick={() => onChange(step(avatar, key, 1))}
            >
              ›
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
