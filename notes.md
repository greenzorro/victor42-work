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
  2. `bindThemeControls` + `bindBackgroundWarmupControls` + `syncThemeIcon`
  3. `loadProducts` — `fetch('./data.json?v=YYYYMMDD')`；请求结束后安排非当前主题的背景预热
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
- **深色大卡图片**：同时使用 `filter: brightness(0.8)` 压低色调与 `opacity: 0.7` 降低不透明度，避免封面图在深色背景上过亮

### 3.3 语言

- 右上角语言按钮：当前为中文时显示 `EN`，为英文时显示 `中文`
- 切换后写入 localStorage、更新 `?lang=`（`history.replaceState`）、重渲染文案与 meta
- 壳层静态文案在 `UI_TEXT`；内容文案在 `data.json`

### 3.4 主题与动态背景

#### 3.4.1 公共主题协调

- head 内联脚本按 URL `?theme=` > localStorage > `prefers-color-scheme` 的优先级写入 `data-theme`，避免 FOUC
- 浅色：保持 `#f5f5fa` 背景色，以独立透明 Canvas 在左上叠加柔焦树影；深色：`#18191a` 背景、半透明卡片、星云 Canvas opacity 0.62
- `main.js` 按主题互斥启停背景：dark → 树影 `stop()`、星系 `start()`；light → 星系 `stop()`、树影 `start()`
- 两个背景模块都支持幂等 `prepare()`：校准 Canvas 视口尺寸并生成或复用模块资源，不设置 `wantRun`，也不启动 RAF
- `loadProducts()` 结束后，`main.js` 通过 `requestIdleCallback` 预热非当前主题，不支持时使用 1.2 s 定时器。主题切换使用双层 `requestAnimationFrame`，先绘制页面颜色与按钮图标，再启停背景动画；视口变化或页面重新可见后会重新安排预热
- 两个模块各自处理 resize、tab 可见性和 `prefers-reduced-motion`。减少动态效果时，星系隐藏，树影保留静态帧；退出该设置后按页面主题决定是否运行动画

#### 3.4.2 浅色背景：树影

- **模块与 API**：`assets/background_light.js` 暴露 `LeafShadowBackground.init / prepare / start / stop / isRunning / destroy`
- **枝叶生成**：树影由 `prepare()` / `start()` 按需生成，并在有效 resize 后重建；固定随机种子确保远、中、近三层枝叶轮廓稳定。疏密由角点距离、外弧距离、低频斑块噪声和三层共享的高频微型漏光场共同决定；微型漏光场会降低局部叶片数量，形成小型稀疏区。每层包含 5 根可见主枝，分别对应 5 个独立扇形运动区；每根主枝的后 20% 与末端都有随枝条同步运动的专属叶团，摇曳时不会从树冠中露出光秃枝梢
- **投影与合成**：远、中、近层分别使用 22、12.5、6.5 px 的半影尺度，紧凑软核心兼顾平坦内部和柔和边缘。所有枝叶区域先合成为一张不透明遮挡蒙版，再统一着色一次，重叠叶片不会重复加深；仅轮廓半影保留明暗过渡。投影默认沿页面垂直方向拉伸 1.40 倍，以表现斜入射光造成的形变；拉伸方向固定于页面，不随枝组旋转。上边和左边另有 16% 纹理出血区，避免摇曳时露出直角边界
- **动态**：所有运动区共享由长、中、短周期和高频扰动四个非整数倍波形叠加成的风力，默认风力倍率为 1.35。风力以 0–1.60 s 的时差到达不同枝组和景深层，使形变顶点与回弹起点错开，同时保持总体风向一致；各区域再以略有差异的刚度和近临界阻尼响应。风力没有短周期重复，减弱后枝条回到中性位置，默认 24 FPS
- **资源与兼容性**：同一视口内多次调用 `start()` / `stop()` 会复用枝叶纹理；`destroy()` 会停止动画、解除监听器并清除 resize 定时器。树影不依赖外部图片，要求浏览器支持 Canvas 2D `filter: blur()`

##### 配置参数

通过 `LeafShadowBackground.init(canvas, options)` 覆盖：

| 参数 | 默认值 | 作用 |
|------|--------|------|
| `shadowColor` | `#26342e` | 树影颜色 |
| `shadowOpacity` | `0.14` | 最终统一着色透明度 |
| `windStrength` | `1.35` | 复合风力倍率，只改变受风偏转强度 |
| `verticalStretch` | `1.40` | 沿页面垂直方向的投影拉伸倍率 |
| `targetFps` | `24` | 动画目标帧率 |
| `dprCap` | `1.5` | Canvas 设备像素比上限 |
| `seed` | `20260720` | 固定枝叶分布的随机种子 |
| `edgeOverscan` | `0.16` | 上、左侧防露边纹理出血比例 |

#### 3.4.3 深色背景：星系

- **模块与 API**：`assets/background_dark.js` 暴露 `StarfieldBackground.init / prepare / prepareAsync / start / stop / isRunning / destroy`
- **渲染管线**：
  1. 预渲染 face-on 连续密度场，包括旋臂、尘带压暗与色阶
  2. 多级缩小、放大与柔化，形成连续星云体
  3. 每帧进行倾角压扁和盘面内旋转
  4. 按深度合并盘面切片、核球与 3D 投影星点
  5. 叠加软核球 bloom、恒星晕和深空背景星场
- **动态与视觉**：盘面逆时针旋转，拖曳臂使用 θ = -ln(r)/b。近侧尘埃切片覆盖核球，旋臂间隙透出背景恒星以形成视差深度；尘埃带延伸至核心边缘，核球以暖黄、粉橘至白炽渐变过渡，内旋臂为低饱和紫调，外缘为窄带冰蓝色
- **资源与调度**：背景星场以 1600 颗星点为基准，并按视口面积缩放数量；盘面星点集中于旋臂与核心区域。同一视口内多次调用 `start()` / `stop()` 会复用纹理与粒子。`prepareAsync()` 把星云像素生成拆成每批最多 2 行、6 ms 的闲时任务；若生成尚未完成便启动星系，则提高为每批最多 4 行、9 ms，且每批结束后让出主线程。`destroy()` 会停止动画、解除监听器、清除 resize 定时器，并使进行中的资源生成失效

##### 配置参数

通过 `StarfieldBackground.init(canvas, options)` 覆盖：

| 参数 | 默认值 | 作用 |
|------|--------|------|
| `targetFps` | `30` | 动画目标帧率 |
| `rotationPeriodSec` | `300` | 盘面完整旋转一周的秒数 |
| `dprCap` | `1.5` | Canvas 设备像素比上限 |
| `textureSize` | `480` | 星系密度纹理的基准边长 |
| `particleCount` | `4800` | 盘面粒子的基准数量 |
| `fieldStarCount` | `1600` | 深空背景星点的基准数量 |
| `tiltDeg` | `76` | 盘面由正视转向侧视的倾角 |
| `yawDeg` | `-20` | 盘面在屏幕内的偏航角 |
| `armCount` | `2` | 主旋臂数量 |
| `armTightness` | `0.27` | 对数螺旋的紧密程度 |
| `scaleFactor` | `0.9` | 星系相对视口的显示尺度 |

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
- **分享图不对**：OG/Twitter 图片必须使用 `work.victor42.work` 下的绝对 URL
- **缓存旧列表**：硬刷新；检查 `data.json?v=` 是否已 bump

## 7. 本地预览

任意静态服务器根目录指向本仓库即可，例如：

```bash
npx --yes serve .
```

打开提示的本地地址；改 `data.json` 后注意浏览器缓存与 `DATA_URL` 版本。
