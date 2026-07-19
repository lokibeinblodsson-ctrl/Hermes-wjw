import { initials } from "../utils";
import type { PresenceStatus } from "../types";

const presenceColor: Record<PresenceStatus, string> = {
  online: "#6f8f7d",
  away: "#d9b35e",
  offline: "#b9b4c2",
};

export function UserAvatar({
  name,
  color,
  size = 36,
  presence,
}: {
  name: string;
  color: string;
  size?: number;
  presence?: PresenceStatus;
}) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="inline-flex items-center justify-center rounded-xl font-semibold text-white select-none"
        style={{
          width: size,
          height: size,
          background: color,
          fontSize: size * 0.38,
          borderRadius: size * 0.28,
        }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      {presence && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white dark:border-ink-900"
          style={{ width: size * 0.32, height: size * 0.32, background: presenceColor[presence] }}
          title={presence}
        />
      )}
    </span>
  );
}
