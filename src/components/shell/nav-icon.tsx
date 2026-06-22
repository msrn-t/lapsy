// ナビアイコン（LAP-014 §4）。nav.ts は純データに保つため、key→アイコンの対応表は
// 描画側（ここ）に持つ。WF の .nav-ico は 16px 角丸プレースホルダ枠だが、設計で
// 「実アイコン採用可」とされているため、最小限の inline SVG（グレースケール・線画）で
// 各セクションを表す。依存追加（アイコンライブラリ）は行わない（設計の SVG 自作方針）。

type IconProps = { className?: string };

const base = "h-4 w-4 flex-none";

function Svg({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ?? base}
    >
      {children}
    </svg>
  );
}

function DashboardIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </Svg>
  );
}

function TimerIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 13V9" />
      <path d="M9 2h6" />
    </Svg>
  );
}

function TopicsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h10" />
    </Svg>
  );
}

function PresetsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 4v5" />
    </Svg>
  );
}

function AdminIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    </Svg>
  );
}

function AccountIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c0-3.5 3-6 7-6s7 2.5 7 6" />
    </Svg>
  );
}

function LogoutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}

function MenuIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </Svg>
  );
}

const ICONS: Record<string, (p: IconProps) => React.ReactNode> = {
  dashboard: DashboardIcon,
  timer: TimerIcon,
  topics: TopicsIcon,
  presets: PresetsIcon,
  admin: AdminIcon,
  account: AccountIcon,
  logout: LogoutIcon,
  menu: MenuIcon,
};

/** ナビ key からアイコンを描画する。未知の key は枠線プレースホルダ（WF .nav-ico 相当）。 */
export function NavIcon({
  navKey,
  className,
}: {
  navKey: string;
  className?: string;
}) {
  const Icon = ICONS[navKey];
  if (!Icon) {
    return (
      <span
        aria-hidden="true"
        className={
          className ??
          "h-4 w-4 flex-none rounded-[5px] border border-line-strong"
        }
      />
    );
  }
  return <Icon className={className ?? base} />;
}
