// ブランドロゴ（LAP-014 §4）。WF 04-dashboard.html の nav-brand svg（グレースケール版）
// + "Lapsy"（Fredoka）。app shell はグレースケールデザインのため、彩色版
// src/app/icon.svg ではなく WF のグレースケール svg を採用する。server component で可。

export function BrandLogo() {
  return (
    <div className="flex items-center gap-2 px-1.5">
      <svg
        viewBox="0 0 512 512"
        role="img"
        aria-label="Lapsy"
        className="h-[26px] w-[26px]"
      >
        <rect width="512" height="512" rx="120" fill="#DADADA" />
        <circle cx="256" cy="256" r="116" fill="#FFFFFF" />
        <ellipse cx="216.5" cy="297.8" rx="34.8" ry="18.6" fill="#ECECEC" />
        <ellipse cx="295.4" cy="216.6" rx="23.2" ry="15.1" fill="#F2F2F2" />
        <path
          d="M366.2,134.9 L373.5,153.6 L392.2,160.9 L373.5,168.2 L366.2,186.9 L358.9,168.2 L340.2,160.9 L358.9,153.6 Z"
          fill="#BFBFBF"
        />
        <circle cx="142.3" cy="207.3" r="6.5" fill="#FFFFFF" />
        <circle cx="192.2" cy="135.4" r="4.5" fill="#FFFFFF" />
      </svg>
      <span className="font-[family-name:var(--font-fredoka)] text-[18px] font-semibold text-ink">
        Lapsy
      </span>
    </div>
  );
}
