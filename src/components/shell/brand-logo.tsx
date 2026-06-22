// ブランドロゴ（LAP-014 §4 / LAP-018 でブランドカラーへ移行）。WF 04-dashboard.html の nav-brand svg
// + "Lapsy"（Fredoka）。WF はあえてグレースケールの仮版だったが、LAP-018 で brand-icon.tsx と同一の
// ブランド配色（#54C3F1 / #FFC93C 等）へ移植した（図形構造は brand-icon と完全一致）。
// ロゴはブランドアートのため SVG 内は意味トークン経由にせず固定 hex を用いる（brand-icon と同じ扱い）。
// server component で可。

export function BrandLogo() {
  return (
    <div className="flex items-center gap-2 px-1.5">
      <svg
        viewBox="0 0 512 512"
        role="img"
        aria-label="Lapsy"
        className="h-[26px] w-[26px]"
      >
        <rect width="512" height="512" rx="120" fill="#54C3F1" />
        <circle cx="256" cy="256" r="116" fill="#FFFFFF" />
        <ellipse
          cx="216.56"
          cy="297.76"
          rx="34.8"
          ry="18.56"
          fill="#DDEFFB"
          opacity="0.85"
        />
        <ellipse cx="295.44" cy="216.56" rx="23.2" ry="15.08" fill="#EAF6FD" />
        <path
          d="M366.2,134.88 L373.48,153.6 L392.2,160.88 L373.48,168.16 L366.2,186.88 L358.92,168.16 L340.2,160.88 L358.92,153.6 Z"
          fill="#FFC93C"
        />
        <circle cx="142.32" cy="207.28" r="6.5" fill="#FFFFFF" opacity="0.9" />
        <circle cx="192.2" cy="135.36" r="4.5" fill="#FFFFFF" opacity="0.75" />
      </svg>
      <span className="font-[family-name:var(--font-fredoka)] text-[18px] font-semibold text-ink">
        Lapsy
      </span>
    </div>
  );
}
