# 无限随机相册画布 — 实现计划

## 背景

构建一个 Next.js 无限随机相册画布应用：
- 充满屏幕的画布，支持鼠标拖拽平移
- 图片随机分布在虚拟坐标空间中
- 拖拽接近边缘时动态生成新图片
- 图片总数超过 50 张时自动销毁距离视野最远的图片

## 技术栈

- **Next.js** (App Router) + **TypeScript**
- **Tailwind CSS** v4
- **Lucide React** 图标库

## 文件结构

```
pView/
├── src/
│   ├── app/
│   │   ├── layout.tsx      # 根布局，设置元数据
│   │   ├── page.tsx         # 主页面，渲染 InfiniteCanvas
│   │   └── globals.css      # Tailwind 引入 + 全局样式
│   ├── components/
│   │   └── InfiniteCanvas.tsx  # 核心组件：拖拽 + 图片管理 + 边缘检测 + 清理
│   └── lib/
│       └── imageGenerator.ts   # 随机位置 / 图片 URL 生成工具
├── package.json
├── tsconfig.json
├── postcss.config.mjs
└── next.config.ts
```

## 架构设计

### 坐标系统

- **世界空间**：无限虚拟画布，每张图片有世界坐标 (x, y)
- **视口**：可见窗口，由 `viewportOffset (ox, oy)` 定义 — 映射到屏幕左上角的世界坐标
- **屏幕→世界**：`worldX = screenX + ox`，`worldY = screenY + oy`

### 组件树

```
page.tsx
 └── InfiniteCanvas.tsx（全屏容器）
      ├── [拖拽层]（捕获鼠标事件，应用 transform）
      └── <img> × N（在世界空间中绝对定位）
```

### 数据模型

```ts
interface ImageItem {
  id: string;          // 唯一 ID（crypto.randomUUID）
  x: number;           // 世界空间 X 坐标（图片中心）
  y: number;           // 世界空间 Y 坐标（图片中心）
  width: number;       // 像素宽度
  height: number;      // 像素高度
  src: string;         // 占位图 URL
  zIndex: number;      // 层叠顺序，点击时提升至顶层
}
```

- **图片来源**：picsum.photos 占位图 (`https://picsum.photos/{w}/{h}?random={seed}`)
- **初始数量**：20 张
- **重叠策略**：允许重叠，点击图片时将其 zIndex 提升至最顶层

## 核心实现细节

### 1. InfiniteCanvas.tsx — 拖拽平移逻辑

- **状态**：
  - `offset: { x: number, y: number }` — 当前视口在世界空间中的偏移
  - `isDragging: boolean` — 鼠标是否按下
  - `dragStart: { x, y }` — 拖拽开始时的鼠标位置
  - `dragStartOffset: { x, y }` — 拖拽开始时的偏移量

- **事件**（绑定在全屏容器 div 上，使用 Pointer Events 统一鼠标和触摸）：
  - `onPointerDown`：`setPointerCapture` 捕获指针，记录 `dragStart`（clientX/Y）和 `dragStartOffset`，设 `isDragging = true`
  - `onPointerMove`：拖拽中计算指针位移增量，`offset = dragStartOffset - delta`
  - `onPointerUp`：设 `isDragging = false`，同时在此判定点击 vs 拖拽（距离 ≤ 5px 为点击）
  - 光标：空闲时 `grab`，拖拽时 `grabbing`

- **渲染**：内层 `<div>` 应用 `transform: translate(offsetX px, offsetY px)`。所有图片为其子元素，使用世界空间坐标绝对定位。

### 2. imageGenerator.ts — 随机分布算法

- **generateImages(centerX, centerY, viewportW, viewportH, count)**：
  - 在 (centerX, centerY) 周围区域生成 `count` 张图片
  - 散布半径：视口对角线约 2 倍，部分偏近、部分偏远
  - 使用类高斯分布，偏向区域中心
  - 每张图片随机尺寸 150-400px
  - 使用 `picsum.photos/{w}/{h}?random={seed}` 作为占位图源

- **generateImagesForEdge(edge, offset, viewportW, viewportH)**：
  - edge = 'top' | 'bottom' | 'left' | 'right' | 'top-left' 等
  - 在指定边缘外侧的带状区域生成图片
  - 当视口边缘距离已生成区域边界 < 200px 时触发

### 3. 边缘检测与动态生成

- 追踪 `generatedBounds`：`{ minX, minY, maxX, maxY }` — 已生成图片的包围盒
- 每次偏移变更时计算可见视口边界：
  - `visibleMinX = offset.x`，`visibleMaxX = offset.x + viewportW`
  - `visibleMinY = offset.y`，`visibleMaxY = offset.y + viewportH`
- 边缘触发阈值 = `Math.max(200, Math.min(viewportW, viewportH) * 0.5)`
- 若 `visibleMinX - generatedBounds.minX < threshold`，触发左侧边缘生成
- 四个方向同理，每次生成 **6 张**，向外扩展 **1 倍视口对角线**
- 300ms throttle 防止快速拖拽重复触发

### 4. 自动清理（> 50 张）

- 每次新增图片后检查 `images.length > 50`
- 计算视口中心：`centerX = offset.x + viewportW/2`，`centerY = offset.y + viewportH/2`
- 计算每张图片距视口中心的距离
- 按距离降序排列，删除最远的图片，**清理到 40 张**（10 张缓冲，防抖动）
- 同时清理距离视口中心 > `viewportDiagonal * 3` 的图片（无论是否达到上限）

### 5. 性能考量

- 事件处理函数使用 `useCallback`
- 拖拽中间态用 `useRef` 存储（避免拖拽中触发重渲染）
- 使用 `ResizeObserver` 监听容器尺寸，更新 viewportW/H
- 内层容器添加 `will-change: transform`
- 使用 `transform: translate3d` 实现 GPU 加速平移
- 每张图片设置 `loading="lazy"` 和 `decoding="async"`
- 使用 `setPointerCapture` 确保指针移出容器后仍可追踪

### 6. 点击置顶

- 维护全局 `zCounter` ref（从 0 开始）
- 在 `pointerup` 时判定：计算起点与终点距离
  - 若 > 5px → 视为拖拽，不触发置顶
  - 若 ≤ 5px → 视为点击，`zCounter` 自增，将该图片 `zIndex` 设为新值
- 图片不阻止事件冒泡，拖拽逻辑正常运作
- 图片加载失败时 `onError` → 替换为纯色 `<div>` + 随机背景色占位

## 实现步骤

### 第 1 步：创建 Next.js 项目脚手架
`npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --no-import-alias`

### 第 2 步：安装 Lucide React
`npm install lucide-react`

### 第 3 步：创建 `src/lib/imageGenerator.ts`
实现随机位置生成和图片 URL 生成工具函数。

### 第 4 步：创建 `src/components/InfiniteCanvas.tsx`
实现完整组件：
- 基于 ref 的拖拽状态管理
- 图片存储管理（增、删、边界追踪）
- 偏移变更时的边缘检测
- 自动清理逻辑
- 内层 div 的 CSS transform 渲染

### 第 5 步：创建 `src/app/page.tsx`
以全屏方式渲染 `<InfiniteCanvas />`。

### 第 6 步：创建 `src/app/layout.tsx`
最小化根布局。

### 第 7 步：更新 `src/app/globals.css`
确保 html/body 全高，移除默认边距。

## 边界与默认决策

以下是对 plan 中模糊点的拍板决定：

### 拖拽交互
- **统一使用 Pointer Events**（`onPointerDown/Move/Up`），一套代码覆盖鼠标 + 触摸
- **使用 `setPointerCapture`**：防止鼠标移出容器后丢失追踪
- **窗口 resize**：用 `ResizeObserver` 监听容器尺寸变化，更新 viewportW/H 基准
- **惯性滑行**：第一期不做，保持简单

### 数值参数
| 参数 | 值 | 说明 |
|------|-----|------|
| 边缘触发阈值 | `Math.max(200, viewportShortSide * 0.5)` | 视口短边的 50%，不低于 200px |
| 清理绝对距离 | `viewportDiagonal * 3` | 超过此距离强制清理，无论总数 |
| 图片尺寸范围 | 150 ~ 400px | 均匀随机 |
| 点击/拖拽判定 | 5px | mouseup 时比较与 mousedown 的距离 |

### 边缘生成频率控制
- 边缘触发后，向外扩展 **1 倍视口对角线** 的范围，每次生成 **6 张**
- 基于 `generatedBounds` 判断已覆盖区域，**同一区域不会重复生成**（天然防重）
- 额外加 **300ms throttle** 防止快速拖拽时重复触发

### 清理策略防抖
- **触发线 50 张，清理到 40 张**（10 张缓冲，避免边界抖动）
- 图片 `<img>` 不做 AbortController，第一期接受可能的带宽浪费

### 点击置顶
- **在 `pointerup` 时判定**：计算起点与终点距离 ≤ 5px 视为点击
- 图片上的事件**不阻止冒泡**，拖拽逻辑正常运作

### 其他
- 图片加载失败时 `onError` → 替换为纯色占位块（`div` + 随机背景色）
- 纯画布，**不加任何调试 UI overlay**

---

## 验证

1. `npm run dev` — 应用无错启动
2. 打开浏览器 — 看到全屏画布上随机分布着占位图片
3. 鼠标/触摸拖拽 — 画布平滑平移，光标变为 grabbing
4. 缩放浏览器窗口 — 画布自适应，图片分布不受影响
5. 向一个方向持续拖拽 — 新图片在前进方向边缘动态出现
6. 持续平移 — 图片总数保持 ≤50，远处的旧图片被移除
7. 点击被遮挡的图片 — 该图片浮到最顶层
8. 关闭图片的标签页 — 图片显示纯色占位块
9. `npm run build` — 生产构建通过
