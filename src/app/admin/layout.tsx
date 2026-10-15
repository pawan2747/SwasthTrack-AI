import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminFrame } from "@/components/admin/admin-frame";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
