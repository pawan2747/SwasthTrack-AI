import {
  Apple,
  FileText,
  FlaskConical,
  HeartPulse,
  History,
  LayoutDashboard,
  Pill,
  Settings,
  UserCheck,
  UserCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavigationItem = {
  href: string;
  label: string;
  hindiLabel?: string;
  icon: LucideIcon;
};

export const navigationItems: NavigationItem[] = [
  { href: "/", label: "Dashboard", hindiLabel: "डैशबोर्ड", icon: LayoutDashboard },
  { href: "/food", label: "Food", hindiLabel: "भोजन", icon: Apple },
  { href: "/health", label: "Health", hindiLabel: "स्वास्थ्य", icon: HeartPulse },
  { href: "/medicines", label: "Medicines", hindiLabel: "दवाइयाँ", icon: Pill },
  { href: "/timeline", label: "Timeline", hindiLabel: "यात्रा", icon: History },
  { href: "/reports", label: "Reports", hindiLabel: "रिपोर्ट्स", icon: FileText },
  { href: "/caregiver", label: "Caregiver", hindiLabel: "केयरगिवर", icon: UserCheck },
  { href: "/simulation-lab", label: "Simulation Lab", hindiLabel: "सिमुलेशन लैब", icon: FlaskConical },
  { href: "/profile", label: "Profile", hindiLabel: "प्रोफाइल", icon: UserCircle },
  { href: "/settings", label: "Settings", hindiLabel: "सेटिंग्स", icon: Settings },
];

export const secondaryNavigationItems = [
  { label: "Daily routine", value: "Foundation" },
  { label: "Tracking status", value: "Database backed" },
  { label: "Medical mode", value: "Phase 2 Active" },
];
