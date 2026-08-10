import type { Metadata } from "next";
import { AdminApp } from "../components/AdminApp";

export const metadata: Metadata = { title: "管理後台" };

export default function AdminPage() {
  return <AdminApp />;
}
