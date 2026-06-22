// 共有ブランドアイコン（LAP-016 §4-6）。
// login が確立した水色ブランド SVG を公開ページ全体（ランディング・reset 系）で共有する。
// WF はモノクロ仮だが、login の水色ブランドを現行の正として統一する。
// size は文脈で可変（login=112 / reset・landing=52）。

export function BrandIcon({ size = 112 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label="Lapsy"
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
  );
}
