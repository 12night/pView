# CLAUDE.md — pView 项目规范

## 项目概述

"无限随机相册画布" — Next.js 全屏画布应用，支持鼠标拖拽平移、图片随机分布、边缘动态加载、自动清理。

## 技术栈

- Next.js (App Router) + TypeScript — 所有组件使用 `.tsx`
- Tailwind CSS v4 — 所有样式优先使用 Tailwind 类名
- Lucide React — 图标来源

## 代码规范

### 文件命名
- 组件文件：`PascalCase.tsx`
- 工具函数文件：`camelCase.ts`
- 每个文件只导出一个核心实体（组件或函数模块）

### 组件结构
- 使用函数组件 + Hooks，不引入 class 组件
- 组件内部保持从上到下的顺序：refs → state → derived values → effects → handlers → render
- 不在 JSX 中编写复杂逻辑，提取为变量或函数

### 样式
- 优先使用 Tailwind 原子类，仅在 Tailwind 无法满足时写自定义 CSS
- 不引入第三方 UI 组件库
- 颜色方案：暗色背景主题（slate-900 系）

### TypeScript
- 所有函数参数和返回值必须显式声明类型
- 不使用 `any`，未知类型使用 `unknown`
- Interface 命名不加 `I` 前缀

### 性能
- 高频事件（mousemove、scroll）中用 `useRef` 存中间态，避免触发重渲染
- 需要 memo 的场景优先使用 `useMemo`/`useCallback`
- 图片使用 `loading="lazy"` 懒加载

### 状态管理
- 组件内部状态用 `useState`
- 跨组件通信优先用 props 下传
- 暂不引入全局状态库

## 当前任务

正在实现核心画布拖拽逻辑和基础图片随机分布算法。详细计划见 `plan.md`。

## 禁止事项

- 不要为内部逻辑写多行注释或 JSDoc（逻辑自解释）
- 不要引入项目不需要的依赖
- 不要在未与用户确认前修改 `CLAUDE.md`
