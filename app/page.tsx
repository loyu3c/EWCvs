import type { Metadata } from "next";
import { VoteApp } from "./components/VoteApp";

export const metadata: Metadata = {
  title: "福委改選投票系統",
  description: "安全、清楚、方便使用的福委改選投票入口。",
};

export default function Home() {
  return <VoteApp />;
}
