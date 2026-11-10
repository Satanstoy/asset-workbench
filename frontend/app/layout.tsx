import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SessionProvider } from "@/features/identity/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "素材制作工作台",
  description: "按模板准备图片、提交制作并查看个人记录。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <SessionProvider><main className="page-shell">{children}</main></SessionProvider>
      </body>
    </html>
  );
}
