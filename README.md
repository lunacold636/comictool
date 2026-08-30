# 漫画标签库 (Comic Tag Library)

本机漫画标签管理工具：漫画按单本分文件夹保存，工具在不动文件夹结构的前提下，加一层**手动维护的 tag 元数据**，支持总览 / 筛选 / 详情编辑。支持「单本」和「连载系列」两种目录结构。

## 功能

- **总览**：卡片网格展示所有漫画（封面缩略图 + 名称 + tag）
- **视图切换**：顶栏「单本 / 全集」一键切换（默认全集，记忆上次选择）；全集视图把连载系列聚合为一张卡片，卡片带「📚 连载 · N集」角标，封面与名称取系列第一个子文件夹
- **筛选**：按 tag 筛选（AND / OR 可切换）、未分类、搜索（支持漫画名 / 作者）、排序
- **详情**：点进单本查看 tag、添加 / 删除 tag、打开文件夹、重命名文件夹
- **系列标签**：在系列卡片或单本详情的「编辑系列标签」中维护，一次标记即应用到该系列全部单集；系列弹窗内可列出全部单集、逐集编辑 tag
- **作者**：与 tag 独立的手动元数据（绿色系展示，和 tag 明显区分）。可按作者搜索、筛选（跟随 AND / OR），卡片与详情展示作者，单本 / 系列均可维护；系列作者一次标记应用到全系列。设置 → 标签管理 里可对作者全局改名（同名 = 合并）或删除
- **全局标签管理**：改名（改名成已有标签 = 合并）、删除
- **数据**：本地 JSON 文件（`data/comics.json`），复制即备份
- 所有 tag 均为手动输入维护，**不做任何自动识别**

## 运行

- 需要 [Node.js](https://nodejs.org/) 18+
- 双击 `start.bat`（或命令行 `npm start`）
- 启动后自动打开浏览器：<http://127.0.0.1:38417/>
- 首次使用：点「设置」→ 粘贴漫画库总文件夹完整路径 → 保存


## 托盘模式（推荐）

不想每次开黑框、还想开机自启动？项目内置了一个 **C# 托盘程序**（`ComicTray.exe`，用系统自带 .NET Framework 4.x 编译，零第三方依赖）：

- **编译**：双击 `build-tray.bat` 生成 `ComicTray.exe`（仓库里也已附带编译好的 exe，可直接用）
- **启动**：双击 `ComicTray.exe`，或在托盘菜单里勾选「开机自启动」后每次开机自动运行
  - 没有任何命令行黑框，静默在后台启动 Node 服务
  - 启动后不会自动弹浏览器；**左键双击托盘图标**即可打开漫画库
  - 托盘图标在任务栏右下角（蓝底白「书」字）
- **右键托盘菜单**：
  - 打开漫画库：浏览器打开 <http://127.0.0.1:38417/>
  - 开机自启动：勾选 = 开机自启（写入当前用户的 HKCU Run 注册表），取消 = 关闭
  - 启动服务：服务意外退出后可手动重启
  - 退出：退出托盘，并关闭由它启动的 Node 服务
- 单实例：已有一个托盘在跑时，再次启动会直接忽略；如果服务已被其它方式启动，托盘会自动检测到并直接使用

> `start.bat` 仍保留，用于调试 / 命令行场景。

## 目录结构规则

根目录下有两种情况，工具会自动识别：

- **单本**：文件夹内直接有图片 → 这个文件夹就是「一本」。
- **连载系列**：文件夹内没有图片、但有子文件夹 → 视为系列容器，**递归扫描子文件夹**，每个含图片的子文件夹（如 `第01卷`）当作「一本」展示；系列容器本身不作为一本显示，页面以「漫画名-集数」的形式展示（如 `海贼王-第01卷`）。

空文件夹会被忽略。如果某个文件夹里既有图片又有子文件夹，则按「一本」处理（不继续下探）。

> 顶栏「单本 / 全集」：**单本视图**每个子文件夹一张卡；**全集视图**（默认）把同一系列的子文件夹聚合为一张卡片（用第一本的名字展示，带连载角标），点击卡片进入系列弹窗，可统一维护系列 tag 或逐集编辑。

## 封面规则

- 优先取该本文件夹内名为 `cover.jpg` / `cover.png` / `cover.webp` 等文件
- 否则取文件夹内**第一张图片**（按文件名自然排序，如 `1.jpg < 2.jpg < 10.jpg`）

## 数据与注意事项

- 数据文件：`data/comics.json`（含库路径、所有 tag 与系列元数据），备份复制它即可
- 数据结构：`comics` 按相对路径存每本 tag 与 authors；`series` 存系列级 tag 与 authors（`{ 系列名: { tags, authors, addedAt, updatedAt } }`）。单卷生效标签 = 系列标签 + 该卷自身标签；作者同理：单卷生效作者 = 系列作者 + 该卷自身作者
- 每本漫画以**相对库根的路径**为唯一标识（如 `连载甲/第01卷`）；如果在资源管理器里改了文件夹名，请在工具详情里用「重命名」同步（或重新添加）
- 新放进库里的文件夹会自动出现在总览（归入「未分类」），手动打 tag 即可
- 工具只监听 `127.0.0.1`，仅本机可访问，完全离线

## 项目结构

```
comictool/
├─ server.js          # Node 服务：静态文件 + JSON API + 封面 + 打开文件夹
├─ start.bat          # 双击启动（命令行 / 调试用）
├─ ComicTray.exe      # 托盘程序（双击常驻，无黑框）
├─ trayhost.cs        # 托盘程序源码
├─ build-tray.bat     # 一键编译 ComicTray.exe
├─ package.json       # 无第三方依赖
├─ public/
│  ├─ index.html      # 单页界面
│  ├─ app.js          # 前端逻辑
│  └─ style.css       # 样式
├─ data/
│  └─ comics.json     # 中心索引（首次运行自动生成）
└─ docs/
   └─ 需求分析与方案规划.md
```

## API（简要）

```
GET    /api/state                       → 漫画列表 + 全部 tag + 库路径
POST   /api/rescan                      → 扫描库目录，返回新增 / 消失的漫画
POST   /api/config                      → 设置库路径
GET    /api/cover?id=<相对路径>          → 返回该本封面图
PUT    /api/comics/tags                 → 整体替换 tag 集合（body: id, tags）
POST   /api/comics/tags                 → 增加一个或多个 tag（body: id, tags）
POST   /api/comics/tags/delete          → 删除某个 tag（body: id, tag）
POST   /api/tags/rename                 → 全局改名（同名 = 合并，同步系列标签）
POST   /api/tags/delete                 → 全局删除标签（同步系列标签）
PUT    /api/series/tags                 → 整体替换系列标签（body: name, tags）
POST   /api/series/tags                 → 给系列增加标签（body: name, tags）
POST   /api/series/tags/delete          → 删除系列某个标签（body: name, tag）
PUT    /api/comics/authors               → 整体替换单本作者集合（body: id, authors）
POST   /api/comics/authors               → 增加单本作者（body: id, authors）
POST   /api/comics/authors/delete        → 删除单本某作者（body: id, author）
PUT    /api/series/authors               → 整体替换系列作者（body: name, authors）
POST   /api/series/authors               → 给系列增加作者（body: name, authors）
POST   /api/series/authors/delete        → 删除系列某作者（body: name, author）
POST   /api/authors/rename               → 全局作者改名（同名 = 合并，同步漫画与系列）
POST   /api/authors/delete               → 全局删除作者（同步漫画与系列）
POST   /api/comics/rename               → 重命名文件夹并同步索引（body: id, to）
POST   /api/open-folder                 → 用资源管理器打开该本目录（body: id）

> id = 相对漫画库根的路径，用 `/` 分隔（如 `连载甲/第01卷`）；根级单本的 id 就是文件夹名。
```