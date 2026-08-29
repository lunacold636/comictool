# 漫画标签库 (Comic Tag Library)

本机漫画标签管理工具：漫画按单本分文件夹保存，工具在不动文件夹结构的前提下，加一层**手动维护的 tag 元数据**，支持总览 / 筛选 / 详情编辑。

## 功能

- **总览**：卡片网格展示所有漫画（封面缩略图 + 名称 + tag）
- **筛选**：按 tag 筛选（AND / OR 可切换）、未分类、名称搜索、排序
- **详情**：点进单本查看 tag、添加 / 删除 tag、打开文件夹、重命名文件夹
- **全局标签管理**：改名（改名成已有标签 = 合并）、删除
- **数据**：本地 JSON 文件（`data/comics.json`），复制即备份
- 所有 tag 均为手动输入维护，**不做任何自动识别**

## 运行

- 需要 [Node.js](https://nodejs.org/) 18+
- 双击 `start.bat`（或命令行 `npm start`）
- 启动后自动打开浏览器：<http://127.0.0.1:38417/>
- 首次使用：点「设置」→ 粘贴漫画库总文件夹完整路径 → 保存

## 封面规则

- 优先取文件夹内名为 `cover.jpg` / `cover.png` / `cover.webp` 等文件
- 否则取文件夹内**第一张图片**（按文件名自然排序，如 `1.jpg < 2.jpg < 10.jpg`）

## 数据与注意事项

- 数据文件：`data/comics.json`（含库路径和所有 tag），备份复制它即可
- 每本漫画以**文件夹名**为唯一标识；如果在资源管理器里改了文件夹名，请在工具详情里用「重命名」同步（或重新添加）
- 新放进库里的文件夹会自动出现在总览（归入「未分类」），手动打 tag 即可
- 工具只监听 `127.0.0.1`，仅本机可访问，完全离线

## 项目结构

```
comictool/
├─ server.js          # Node 服务：静态文件 + JSON API + 封面 + 打开文件夹
├─ start.bat          # 双击启动
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
POST   /api/rescan                      → 扫描库目录，返回新增 / 消失的文件夹
POST   /api/config                      → 设置库路径
GET    /api/cover?folder=<name>         → 返回该本封面图
PUT    /api/comics/<folder>/tags        → 整体替换 tag 集合
POST   /api/comics/<folder>/tags        → 增加一个或多个 tag
DELETE /api/comics/<folder>/tags/<tag>  → 删除某个 tag
POST   /api/tags/rename                 → 全局改名（同名 = 合并）
POST   /api/tags/delete                 → 全局删除标签
POST   /api/comics/rename               → 重命名文件夹并同步索引
POST   /api/open-folder                 → 用资源管理器打开该本目录
```