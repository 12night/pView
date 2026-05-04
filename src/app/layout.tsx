import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '无限相册画布',
  description: '无限随机相册画布 — 拖拽平移、动态加载、自动清理',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full m-0 p-0 overflow-hidden">{children}</body>
    </html>
  );
}
