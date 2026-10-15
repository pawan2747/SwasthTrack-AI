import {
  Apple,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  Info,
  LayoutDashboard,
  Mail,
  MessageSquareText,
  Pill,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  UserCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationItem = {
  href: string;
  label: string;
  hindiLabel: string;
  icon: LucideIcon;
  /** Tighter label for the 17rem sidebar, where the full one would truncate. */
  shortLabel?: string;
};

/**
 * The five destinations on the mobile bottom bar. Kept deliberately short —
 * everything else lives in `secondaryNavigation` (§16).
 */
export const primaryNavigation: NavigationItem[] = [
  { href: "/", label: "Home", hindiLabel: "होम", icon: LayoutDashboard },
  { href: "/food", label: "Food", hindiLabel: "भोजन", icon: Apple },
  { href: "/health", label: "Health", hindiLabel: "स्वास्थ्य", icon: HeartPulse },
  { href: "/medicines", label: "Medicines", hindiLabel: "दवाइयाँ", icon: Pill },
  { href: "/reports", label: "Reports", hindiLabel: "रिपोर्ट्स", icon: FileText },
];

/** Reached from the header menu on mobile, and the sidebar on desktop. */
export const secondaryNavigation: NavigationItem[] = [
  { href: "/timeline", label: "Timeline", hindiLabel: "स्वास्थ्य यात्रा", icon: History },
  { href: "/insights/changes", label: "What changed", hindiLabel: "क्या बदला", icon: TrendingUp },
  { href: "/ask", label: "Ask SwasthTrack", hindiLabel: "डेटा से पूछें", icon: MessageSquareText },
  { href: "/caregiver", label: "Caregiver", hindiLabel: "केयरगिवर", icon: UserCheck },
  { href: "/profile", label: "Profile", hindiLabel: "प्रोफाइल", icon: UserCircle },
  { href: "/settings", label: "Settings", hindiLabel: "सेटिंग्स", icon: Settings },
];

/** Developer / QA surface. Only shown to admin accounts. */
export const developerNavigation: NavigationItem[] = [
  { href: "/simulation-lab", label: "AI & Simulation Lab", hindiLabel: "AI और सिमुलेशन लैब", icon: FlaskConical },
];

export const informationNavigation: NavigationItem[] = [
  { href: "/about", label: "About", hindiLabel: "परिचय", icon: Info },
  { href: "/contact", label: "Contact", hindiLabel: "संपर्क", icon: Mail },
  {
    href: "/medical-disclaimer",
    label: "Medical disclaimer",
    shortLabel: "Disclaimer",
    hindiLabel: "चिकित्सा अस्वीकरण",
    icon: ShieldCheck,
  },
];

/**
 * Whether `pathname` is inside the section `href` points at, so `/insights/changes/…`
 * keeps its parent highlighted. Home only matches exactly.
 */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
