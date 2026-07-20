# 小玩意项目备忘录

## 1. 目的

记录 `projects/victor42-work`（线上 https://work.victor42.work/）的结构与维护约定，供本人与 Agent 后续改站时对齐。

**约定：** 改功能或数据结构后，同步更新本文，使其持续描述当前实现。

## 2. 项目概述

静态产品展示页：用 JSON 驱动个人简介与作品列表，支持中英切换与深/浅色主题。无构建步骤，适合 Cloudflare Pages 等静态托管。

### 2.1 技术栈

- **HTML5**：页面壳、SEO meta、JSON-LD 占位、背景 `<canvas>`
- **CSS3**：响应式 Grid、CSS 变量主题、`:focus-visible`
- **JavaScript (ES6)**：`fetch` 加载数据、DOM 渲染、语言/主题
- **JSON**：`data.json` 为唯一内容源（文案双语）
- **LocalStorage**：主题 `theme`、语言 `language`
- **Canvas 动态背景**：浅色树影 `LeafShadowBackground` 与深色星云 `StarfieldBackground` 均为可移植模块，由主脚本按主题互斥启停

### 2.2 文件结构

```
victor42-work/
├── index.html          # 页面壳、SEO、主题 FOUC 脚本、GA
├── data.json           # 标题 / 简介 / 作品列表（中英）
├── assets/
│   ├── main.js         # 加载、渲染、语言、主题
│   ├── background_light.js # 可移植树影背景（LeafShadowBackground）
│   ├── background_dark.js # 可移植星云背景（StarfieldBackground）
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
  4. `initBackgrounds` — 初始化树影与星云模块，`syncBackgrounds` 按当前主题互斥启停
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

### 3.4 主题与动态背景

- head 内联脚本读 localStorage / `prefers-color-scheme`，写 `data-theme`，避免 FOUC
- 浅色：保持 `#f5f5fa` 背景色，以独立透明 Canvas 在左上叠加柔焦树影；深色：`#18191a` 背景、半透明卡片、星云 Canvas opacity 0.62
- 树影逻辑在独立 `assets/background_light.js`，全局 API：`LeafShadowBackground.init / start / stop / isRunning / destroy`
- 树影在初始化或 resize 时用固定随机种子生成远、中、近三层枝叶轮廓；疏密由角点距离、外弧距离、低频斑块噪声和三层共享的高频微型漏光场共同决定，微型漏光场会额外降低局部叶片数量以形成更多小型稀疏区。每层包含 5 根可见主枝，分别对应 5 个独立的扇形运动区；每根主枝的后 20% 与末端都有随枝条同步运动的专属叶团，避免错峰摇曳时从树冠中露出光秃枝梢。远、中、近层分别使用 22、12.5、6.5 px 的半影尺度，并以紧凑的软核心维持平坦内部，使轮廓只比初版略软。整个枝叶投影默认沿页面垂直方向拉伸 1.18 倍，用于模拟斜入射光造成的投影变形；拉伸方向固定于投影面，不随各枝组旋转。运行时所有运动区共享由长、中、短周期和高频扰动四个非整数倍波形叠加成的风力，默认风力倍率为 1.28；风力以 0–1.42 s 的时差依次到达不同枝组和景深层，使形变顶点与回弹起点进一步错开，同时保持总体风向一致。各区域再以略有差异且相对柔和的刚度和近临界阻尼响应。风力变化没有短周期重复，减弱后枝条会回到中性位置，不会像柔软材质持续漂荡，默认 24 FPS。主枝在叶冠内部收束，外围不出现无叶枝梢。所有枝叶区域先合成为一张不透明遮挡蒙版，再统一着色一次，重叠叶片不会重复加深；仅轮廓半影保留明暗过渡。上边和左边另有 16% 纹理出血区，避免摇曳时露出直角边界
- 树影依赖现代浏览器的 Canvas 2D `filter: blur()`；不再维护缩放模拟模糊的旧浏览器降级路径

#### 浅色树影迁移参数

通过 `LeafShadowBackground.init(canvas, options)` 覆盖：

| 参数 | 默认值 | 作用 |
|------|--------|------|
| `shadowColor` | `#26342e` | 树影颜色 |
| `shadowOpacity` | `0.14` | 最终统一着色透明度 |
| `windStrength` | `1.28` | 复合风力倍率，只改变受风偏转强度 |
| `verticalStretch` | `1.18` | 沿页面垂直方向的投影拉伸倍率 |
| `targetFps` | `24` | 动画目标帧率 |
| `dprCap` | `1.5` | Canvas 设备像素比上限 |
| `seed` | `20260720` | 固定枝叶分布的随机种子 |
| `edgeOverscan` | `0.16` | 上、左侧防露边纹理出血比例 |
- 星云逻辑在独立 `assets/background_dark.js`，全局 API：`StarfieldBackground.init / start / stop / isRunning / destroy`
- 渲染顺序：
  1. 预渲染 face-on 连续密度场（旋臂 + 尘带压暗 + 色阶）
  2. 多级缩小/放大模糊 → 星云体而非珠串
  3. 每帧 tilt 压扁 + 盘面内旋转绘制纹理
  4. 3D 投影粒子叠亮星（近端厚度）
  5. 大范围软核球 bloom + 分层背景星场
- 动力学：盘面 CCW；拖曳臂使用 θ = -ln(r)/b。
- 视觉细节：尘埃层位于核球之前，旋臂间隙透出背景恒星以形成视差深度；背景星场包含 1600 颗星点，盘面星点集中于旋臂与核心区域。
- 尘埃带延伸至核心边缘并保持连续流体感；核球以暖黄、粉橘至白炽渐变过渡，内旋臂为低饱和紫调，外缘为窄带冰蓝色。
- 主站只负责互斥启停：dark → 树影 `stop()`、星云 `start()`；light → 星云 `stop()`、树影 `start()`。模块内部处理 resize、tab 可见性和 `prefers-reduced-motion`
- `prefers-reduced-motion: reduce` 时星云隐藏，树影保留静态帧；恢复后按当前主题决定是否重启动画
- 暂停/恢复且视口未变化时复用纹理与粒子资源；`destroy()` 会解除全部监听器并清理延迟任务
- 移植：分别拷贝目标背景脚本和对应 Canvas/CSS，再调用该模块的 `init` 与 `start/stop`；树影不依赖外部图片资源

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
| `https://*.victor42.work/` 产品子域 | **不写** | 由各产品站点维护自己的 sitemap；这里只保留卡片外链 |
| GitHub / GitHub Pages / 飞书 / GreasyFork 等 | **不写** | 外链只在 `data.json` 卡片中出现 |

**加产品流程：**

1. 在 `data.json` 追加条目（中英文案、`url`，可选 `image`）
2. `sitemap.xml` 只维护 `https://work.victor42.work/`，产品子域不在此重复收录
3. 更新 `main.js` 的 `DATA_URL` 与 `SITE_DATE_MODIFIED`，以及 `index.html` 内 JSON-LD `dateModified`、CSS/JS 的 `?v=`
4. 若新增封面图，放入 `assets/images/`

### 5.3 robots.txt

允许全站抓取；声明 `Sitemap: https://work.victor42.work/sitemap.xml`。

## 6. 故障排查

- **空白 / 加载失败**：Network 看 `data.json` 是否 200；校验 JSON 语法；确认 `DATA_URL` 版本路径
- **主题不切换**：Application → Local Storage 的 `theme`；控制台报错
- **语言不切换**：`language` 与 URL `lang`；`data.json` 是否缺 `en` 字段（会回退中文）
- **树影不显示**：是否 light；`background_light.js` 是否先于 `main.js` 加载；`#light-background-canvas` 是否存在；控制台是否有脚本错误
- **星云不显示**：是否 dark；系统是否「减少动态效果」；`background_dark.js` 是否先于 `main.js` 加载；控制台是否有脚本错误
- **分享图不对**：OG/Twitter 必须用绝对 URL（当前指向 `work.victor42.work`）
- **缓存旧列表**：硬刷新；检查 `data.json?v=` 是否已 bump

## 7. 本地预览

任意静态服务器根目录指向本仓库即可，例如：

```bash
npx --yes serve .
```

打开提示的本地地址；改 `data.json` 后注意浏览器缓存与 `DATA_URL` 版本。
