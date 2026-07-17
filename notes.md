# 小玩意项目备忘录

## 1. 目的

记录 `projects/victor42-work`（线上 https://work.victor42.work/）的结构与维护约定，供本人与 Agent 后续改站时对齐。

**约定：** 改功能或数据结构后，同步更新本文；以仓库现状为准，不以记忆或旧 commit 为准。

## 2. 项目概述

静态产品展示页：用 JSON 驱动个人简介与作品列表，支持中英切换与深/浅色主题。无构建步骤，适合 Cloudflare Pages 等静态托管。

### 2.1 技术栈

- **HTML5**：页面壳、SEO meta、JSON-LD 占位、背景 `<canvas>`
- **CSS3**：响应式 Grid、CSS 变量主题、`:focus-visible`
- **JavaScript (ES6)**：`fetch` 加载数据、DOM 渲染、语言/主题
- **JSON**：`data.json` 为唯一内容源（文案双语）
- **LocalStorage**：主题 `theme`、语言 `language`
- **Canvas 星云**：`assets/background.js`（可移植模块 `StarfieldBackground`），深色主题时由主脚本 start/stop

### 2.2 文件结构

```
victor42-work/
├── index.html          # 页面壳、SEO、主题 FOUC 脚本、GA
├── data.json           # 标题 / 简介 / 作品列表（中英）
├── assets/
│   ├── main.js         # 加载、渲染、语言、主题
│   ├── background.js   # 可移植星云背景（StarfieldBackground）
│   ├── style.css       # 布局与主题样式
│   └── images/         # 头像、封面、favicon
├── sitemap.xml         # 仅本域可索引 URL
├── robots.txt
├── notes.md            # 本备忘录
├── README.md
└── LICENSE             # MIT
```

## 3. 功能模块

### 3.1 数据驱动渲染

- **`data.json`**：唯一内容源。`title` / `description` / `profile.*` 文案与 `products[].name|description` 均为 `{ "zh", "en" }`；`url`、`emoji`、`image`（可选）为共享字段。
- **`getText(obj)`**：按 `currentLanguage` 取文案，缺省回退 `zh`。
- **主流程**（`DOMContentLoaded`）：
  1. `initializeLanguage` — URL `?lang=` > localStorage > 默认 `zh`
  2. `bindThemeControls` + `syncThemeIcon`
  3. `loadProducts` — `fetch('./data.json?v=YYYYMMDD')`
  4. `initStarfield` — `StarfieldBackground.init`；dark 时 `start()`，light 时 `stop()`
- **渲染**：`renderPage` → `renderProfile` + `createProductCard`；全部 `textContent` / `createElement`，不用 `innerHTML` 拼用户可见内容。
- **加载失败**：显示 `#error`，隐藏 loading。

### 3.2 布局与样式

- **断点**
  - `>1180px`：内容宽 1180px；左 profile sticky，右 4 列 Grid
  - `640–1180px`：内容宽 600px；单栏，2 列 Grid
  - `<640px`：全宽；单栏，2 列 Grid
- **卡片**
  - 有 `image` → `.large-card`（跨 2 列，横向图文）
  - 无 `image` → `.small-card`（1 列）
- **主色** `#2A9D8F`，与博客 Stack 主题一致
- **描述卡**：背景图 `assets/images/tools.webp` + 半透明主色叠层

### 3.3 语言

- 右上角语言按钮：当前为中文时显示 `EN`，为英文时显示 `中文`
- 切换后写入 localStorage、更新 `?lang=`（`history.replaceState`）、重渲染文案与 meta
- 壳层静态文案在 `UI_TEXT`；内容文案在 `data.json`

### 3.4 主题与星云背景

- head 内联脚本读 localStorage / `prefers-color-scheme`，写 `data-theme`，避免 FOUC
- 深色：`#18191a` 背景、半透明卡片、`<canvas class="background-canvas">` opacity 0.62
- 星云逻辑在独立 `assets/background.js`，全局 API：`StarfieldBackground.init / start / stop / isRunning / destroy`
- 视觉 L3 管线：
  1. 预渲染 face-on 连续密度场（旋臂 + 尘带压暗 + 色阶）
  2. 多级缩小/放大模糊 → 星云体而非珠串
  3. 每帧 tilt 压扁 + 盘面内旋转绘制纹理
  4. 3D 投影粒子叠亮星（近端厚度）
  5. 大范围软核球 bloom + 分层背景星场
- 动力学：盘面 CCW；拖曳臂 θ = -ln(r)/b（非 1:1 银河结构）
- 视觉细节：尘埃层位于核球之前，旋臂间隙透出背景恒星以形成视差深度；背景星场包含 1600 颗星点，盘面星点集中于旋臂与核心区域。
- 尘埃带延伸至核心边缘并保持连续流体感；核球以暖黄、粉橘至白炽渐变过渡，内旋臂为低饱和紫调，外缘为窄带冰蓝色。
- 主站只负责：dark → `start()`，light → `stop()`；模块内部处理 resize、tab 可见性、`prefers-reduced-motion`
- `prefers-reduced-motion: reduce` 时停止并清空 Canvas，CSS 同时隐藏背景；恢复后按当前主题决定是否重启
- 暂停/恢复且视口未变化时复用纹理与粒子资源；`destroy()` 会解除全部监听器并清理延迟任务
- 移植：拷贝 `background.js` + 对应 CSS（`.background-canvas`），挂一个 canvas 后调用 API 即可

### 3.5 缓存与资源版本

- CSS / JS 用 query 版本号（`index.html` 内 `?v=`）
- `data.json` 用 `main.js` 中 `DATA_URL` 的 `?v=YYYYMMDD`；**改产品列表时同步改该版本串**
- 结构化数据与 sitemap 的「内容修订日」用 `SITE_DATE_MODIFIED` / sitemap `<lastmod>`，与发布日对齐，不取客户端当天

## 4. 数据结构 (`data.json`)

```json
{
  "title": { "zh": "...", "en": "..." },
  "description": { "zh": "...", "en": "..." },
  "profile": {
    "avatar": "assets/images/....jpg",
    "bio": { "zh": "...", "en": "..." },
    "website": {
      "title": { "zh": "...", "en": "..." },
      "url": "https://..."
    }
  },
  "products": [
    {
      "emoji": "🎵",
      "name": { "zh": "...", "en": "..." },
      "url": "https://...",
      "description": { "zh": "...", "en": "..." },
      "image": "assets/images/....webp"
    }
  ]
}
```

`image` 可选；有图为大卡，无图为小卡。

## 5. SEO

### 5.1 页面侧

- Meta：description、keywords、robots、canonical
- Open Graph / Twitter Card（图片为绝对 URL）
- JSON-LD：`#structured-data` 壳在 HTML，产品列表由 `updateStructuredData` 写入
- 语义标签：`main` / `aside` / `section`；卡片 `aria-label`、图片 `alt`

语言切换是**到站后的 UX**，不是多语言 SEO 工程：无独立英文 URL、无 hreflang。默认与爬虫首屏以中文 meta 为准。

### 5.2 Sitemap 收录规则

`sitemap.xml` **只收录本站可声明所有权的 URL**（搜索引擎会忽略跨站条目）：

| 类型 | 是否写入 sitemap | 说明 |
|------|------------------|------|
| `https://work.victor42.work/` | 必须 | 本页，priority `1.0` |
| `https://*.victor42.work/` 产品子域 | 必须 | priority `0.8`，`changefreq` monthly |
| GitHub / GitHub Pages / 飞书 / GreasyFork 等 | **不写** | 外链只在 `data.json` 卡片中出现 |

**加产品流程：**

1. 在 `data.json` 追加条目（中英文案、`url`，可选 `image`）
2. 若 URL 为 `*.victor42.work`，在 `sitemap.xml` 增加对应 `<url>`，并刷新各条 `<lastmod>`
3. 更新 `main.js` 的 `DATA_URL` 与 `SITE_DATE_MODIFIED`，以及 `index.html` 内 JSON-LD `dateModified`、CSS/JS 的 `?v=`
4. 若新增封面图，放入 `assets/images/`

### 5.3 robots.txt

允许全站抓取；声明 `Sitemap: https://work.victor42.work/sitemap.xml`。

## 6. 故障排查

- **空白 / 加载失败**：Network 看 `data.json` 是否 200；校验 JSON 语法；确认 `DATA_URL` 版本路径
- **主题不切换**：Application → Local Storage 的 `theme`；控制台报错
- **语言不切换**：`language` 与 URL `lang`；`data.json` 是否缺 `en` 字段（会回退中文）
- **星云不显示**：是否 dark；系统是否「减少动态效果」；`background.js` 是否先于 `main.js` 加载；控制台是否有脚本错误
- **分享图不对**：OG/Twitter 必须用绝对 URL（当前指向 `work.victor42.work`）
- **缓存旧列表**：硬刷新；检查 `data.json?v=` 是否已 bump

## 7. 本地预览

任意静态服务器根目录指向本仓库即可，例如：

```bash
npx --yes serve .
```

打开提示的本地地址；改 `data.json` 后注意浏览器缓存与 `DATA_URL` 版本。
