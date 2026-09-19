// Inline stroke icons on a 24px grid. No emoji anywhere in the redesigned UI —
// emoji render differently per platform and cannot take the accent colour.

type Props = { name: IconName; size?: number; className?: string };

export type IconName =
  | 'mark' | 'users' | 'list' | 'clipboard' | 'play' | 'signout' | 'refresh'
  | 'search' | 'chevron-down' | 'chevron-up' | 'chevron-right' | 'arrow-left'
  | 'external' | 'warning' | 'trend' | 'calendar' | 'x';

const P: Record<IconName, React.ReactNode> = {
  // Placeholder brand mark — a pyramid. Swap for the real logo when it lands.
  mark: <><path d="M12 3 21 20H3L12 3Z" /><path d="M12 9l4.5 9h-9L12 9Z" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  clipboard: <><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>,
  play: <path d="M7 4.5v15l12-7.5L7 4.5Z" />,
  signout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>,
  search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m18 15-6-6-6 6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'arrow-left': <path d="m12 19-7-7 7-7M19 12H5" />,
  external: <><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></>,
  warning: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
  trend: <><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  x: <path d="M18 6 6 18M6 6l12 12" />,
};

// 'play' and 'mark' read better filled/heavier than the 1.75 stroke default.
const FILLED: IconName[] = ['play'];

export default function Icon({ name, size = 18, className }: Props) {
  const filled = FILLED.includes(name);
  return (
    <span className={className ? `ic ${className}` : 'ic'} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 24 24"
        fill={filled ? 'currentColor' : 'none'}
        stroke={filled ? 'none' : 'currentColor'}
        strokeWidth={name === 'mark' ? 2 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {P[name]}
      </svg>
    </span>
  );
}
