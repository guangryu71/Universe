# 🌌 Starry Sky Universe

**浏览器里的 3D 宇宙模拟器 + 星体社区平台** — 基于 Three.js 的 N 体引力场景、多恒星系统切换、宇宙视图、飞船与探测器、AI 星语终端、星球实验室，以及一套完整的账号 / 角色 / 星系成员 / 投稿审核体系。

> 纯 ES Module 前端（无打包、无构建），Python 标准库服务端 + SQLite 持久化。所有界面与注释均为中文。

---

## 📋 目录

- [项目介绍](#-项目介绍)
- [功能总览](#-功能总览)
- [快速开始](#-快速开始)
- [使用说明](#-使用说明)
- [权限与数据](#-权限与数据)
- [项目结构](#-项目结构)
- [服务端 API](#-服务端-api)
- [扩展开发](#-扩展开发)
- [技术栈](#-技术栈)
- [已知限制](#-已知限制)

---

## 🌟 项目介绍

Starry Sky Universe 是一个沉浸式的科幻宇宙交互平台：你可以在三维空间中漫游太阳系与 HD 219134，用「宇宙视图」俯瞰所有星系与星体系统之间的关联，驾驶飞船在舱内漫游，发射探测器，用可视化编辑器搭建自己的天体系统，或者在星球实验室里让 AI 根据一句话生成一套多体系统。

在模拟器之上，它还是一个**社区网站**：注册账号后可以加入星系、投稿星体系统、等待开发者审核，星系指挥官还能管理自己的星系成员，管理员可以在同一套界面里管理用户、内容、星系、新星系资格与背景音乐。

### 核心特色

| 特性 | 说明 |
|------|------|
| **沉浸式 3D 场景** | 12 万主星 + 6 万暗星的着色器星空、Bloom 泛光、程序化星云 |
| **真实物理引擎** | N 体引力（Velocity Verlet，4 子步/帧），全程 SI 单位（kg / m / s） |
| **多恒星系统** | 太阳系、HD 219134 可一键切换，模块化注册制；自定义系统同名同源 |
| **星体数据库** | 以星系为入口浏览、搜索、新建、编辑、导出全部星体系统，含审核状态 |
| **宇宙视图** | 星系图标与星体系统小球同屏，星体关联以线缆展示并钉住查看 |
| **社区平台** | 账号 / 四种角色 / 星系成员 / 投稿审核 / 新星系资格 / 站内通知 |
| **星球实验室** | 独立场景搭建天体，AI 建造、导入星体系统、导出为私人草稿 |
| **星语终端** | SSE 流式 AI 对话，可接云端 API 或本地 OpenAI 兼容服务 |
| **飞船与探测器** | 第一人称舱内漫游、全息投影、跳跃；自动拦截 / 手动瞄准发射探测器 |
| **FUI 科幻界面** | 全息卡片、CRT 扫描线、glitch 动画、打字机音效、自由飞行预览 |

---

## 🎯 功能总览

### 1. 三维场景漫游
- **视角控制**：左键平移 · 中键旋转 · 右键平移 · 滚轮缩放（`zoomToCursor`，带阻尼惯性）
- **星球聚焦**：点击天体 → 摄像机卫星式追踪 + 信息卡片，按 `Esc` 或关闭卡片退出
- **标准视图**：XY / XZ / YZ 正交视角一键切换
- **重绘轨道线**：随时重算当前系统的轨道可视化
- **时间控制**：可调时间流速，物理按 `SIM_DT`（约半天）× 倍率推进

### 2. 物理与天体
- N 体引力引擎，速度 Verlet 积分，每帧 4 子步
- 真实常量：`G = 6.67430×10⁻¹¹`，`AU = 1.495978707×10¹¹ m`
- 内置系统：**太阳系**（恒星 + 8 行星 + 14 卫星）、**HD 219134**（恒星 + 6 行星）
- 卫星为运动学天体，跟随母行星；行星/恒星参与真实引力计算

### 3. 星体数据库（原「星系浏览器」）
- 空搜索时先显示**星系卡片**（图标 / 名称 / 系统数 / 指挥官），点进去看该星系下的星体系统
- 搜索框跨星系检索；每张系统卡片显示所属星系、作者、审核状态
- 新建 / 编辑编译器：单恒星系统表单 + 实时 3D 预览 + 详情文件夹 + 表面图集 + 🔗 星体关联
- 支持导出 / 导入 ZIP；自定义系统的贴图保存在 `Galaxy/custom/<id>/media/`

### 4. 宇宙视图
- 星系 SVG 图标按斐波那契球面分布，星体系统按黄金角排布在同一场景
- 悬停显示星体关联线（青色 = 主动 `from → to`，橙色 = 被动），点击钉住并显示四段弧光环
- 星系编辑：添加 / 编辑 / 删除星系（默认「银河系」受保护），指挥官可编辑自己的星系
- 点击系统中的小球直接进入该系统主场景

### 5. 社区平台
- 账号：注册 / 登录 / 改显示名 / 改密码，Cookie 会话（HttpOnly，服务端只存哈希）
- 四种角色：**开发者 / 管理员 / 星系指挥官 / 星际公民**，权限全部在服务端校验
- 星系成员：加入 / 退出 / 被移除，指挥官可在管理面板查看成员并移除
- 投稿审核：公民投稿进入「审核中」，开发者通过或驳回并附审核意见（驳回后仅作者与管理员可见）
- 草稿箱：编译器的「暂存到草稿箱」与实验室的「导出星体系统」都会生成仅自己可见的草稿，可在个人中心一键发布
- 新星系资格：管理员发布名额，公民先到先得领取，领取后自动成为新星系指挥官
- 站内通知：角色变更、封禁、审核结果、资格发布 / 领取、指挥官任免、被移出星系等事件都会发消息
- 红点 / 「新」标记：个人中心与管理面板的页签红点、行内「新」标签都会在你真正看过该列表后才清除

### 6. 星语终端（AI）
- 点击顶部「星语终端」直接打开，无密码门槛
- 支持两种模式：**云端 API**（OpenAI 兼容，SSE 流式）与**本地服务**（本地 OpenAI 兼容地址）
- AI 永远拿不到 DOM / localStorage / 网络权限，只能看到它自己声明需要的星体/星系记录（两阶段沙箱）
- 星语设置中可配置 API 地址、模型、提示词与浏览器 TTS 语音

### 7. 星球实验室
- 独立 Three.js 场景，复用主场景的星体编辑器与放置流程
- **AI 建造**：用一句话描述想要的系统，AI 只输出 JSON 蓝图，由程序换算成位置与速度
- **导入星体系统**：从星体数据库检索并复制一整套天体到实验室（可按系统名或星系名搜索）
- **导出星体系统**：选择你加入或指挥的星系，保存为私人草稿，之后在个人中心完成发布
- 无限网格、碰撞箱、轨迹线、时间倍率、擦除轨迹

### 8. 飞船与探测器
- 第一人称舱内模式（PointerLockControls），全息投影显示附近天体，可跃迁到目标
- 探测器：自动计算拦截轨道，或手动十字准星瞄准发射，支持一键收回

### 9. 自由飞行预览
- Outer Wilds 式自由视角：鼠标环视、WASD 移动、Shift 加速、Ctrl/Space 升降、滚轮调速、`Esc` 退出

### 10. 音效与语音
- Web Audio API 预加载音效，滑块 / 打字机 / 探测器等变调合成
- 背景音乐播放器由管理面板 → 背景音乐打开（开发者可上传 / 删除）
- 天体介绍使用浏览器 TTS；另有独立的 Python 离线机械音合成器（见下）

---

## 🚀 快速开始

### 环境要求

| 组件 | 要求 |
|------|------|
| 浏览器 | Chrome / Edge / Firefox 等支持 WebGL 2.0 的现代浏览器 |
| Python | 3.8+（运行服务端与语音合成） |
| 网络 | 首次加载需从 CDN（jsDelivr）下载 Three.js 0.160 |
| 内存 | 建议 4GB+ |

### 启动（推荐）

```bash
git clone https://github.com/guangryu71/Universe.git
cd Universe

# Windows 可直接双击 start.bat，或：
python start.py
```

浏览器打开 **http://127.0.0.1:8000** —— 会先看到黑洞封面动画，点击进入主应用。

- `start.py` 会清理占用 8000 端口的旧进程、优先使用 `.venv`，然后启动 `server.py`
- 只想启动服务端：`python server.py`
- 服务端只用 Python 标准库，**不需要安装任何依赖**；`requirements.txt` 仅用于可选的离线语音合成
- **必须通过 HTTP 访问**：直接用 `file://` 打开 `index.html` 会因 ES Module 跨域限制而失败

### 首次使用

1. 打开右上角 🧑‍🚀 个人中心 → 注册。**站点第一个注册的账号会成为「开发者」**，并接管已有的无主星体系统与默认星系「银河系」。
2. 注册成功后会弹出凭证卡片，请牢记账号密码，点击「确认登录」后才算完成。
3. 用开发者账号打开右上角 🛠 网站管理，即可审核投稿、管理用户与星系、发布新星系资格。

> 数据库文件 `Galaxy/universe.db` 在首次启动时自动创建，已加入 `.gitignore`，不会随仓库分发。

### 纯静态托管

任何静态服务器都可以托管前端（`python -m http.server 8000`），但此时没有 `/api/*`，社区功能与 SQLite 持久化不可用，且根路径不会显示封面页。

---

## 📖 使用说明

### 基础操作

| 操作 | 鼠标 / 键盘 | 说明 |
|------|-------------|------|
| 平移场景 | 左键 / 右键拖拽 | 平移视点 |
| 旋转视角 | 中键拖拽 | 围绕目标旋转 |
| 缩放 | 滚轮 | 朝光标方向缩放 |
| 聚焦天体 | 左键点击天体 | 摄像机追踪并弹出信息卡片 |
| 取消聚焦 | `Esc` / 关闭卡片 | 恢复自由视角 |
| 标准视图 | XY / XZ / YZ 按钮 | 切换正交视角 |
| 时间流速 | 时间控件 | 调整模拟速度 |
| 自由飞行 | 🛸 自由飞行预览 | 鼠标环视 + WASD，`Esc` 退出 |

> 除 `Esc` 之外，WASD 等移动键只在自由飞行 / 飞船 / 实验室模式下生效。

### 顶部工具栏

| 按钮 | 功能 |
|------|------|
| 💬 **星语终端** | 打开 AI 对话窗口 |
| ⚙ **星语设置** | AI 接口、提示词与语音朗读设置 |
| 🚀 **进入飞船** | 第一人称舱内模式 |
| 🗄 **星体数据库** | 浏览 / 搜索 / 新建 / 编辑全部星体系统 |
| 🌌 **宇宙视图** | 星系与星体系统的全局视图、星体关联、星系编辑 |
| 🛠 / 🛰 **网站管理 / 星系管理** | 职员与星系指挥官的同一管理窗口（无权限时隐藏） |
| 🧑‍🚀 **个人中心** | 我的系统、消息与资格、账号设置 |
| 🛸 **自由飞行预览** | 自由视角漫游 |
| ⟳ **重绘轨道线** | 重新计算并绘制当前系统轨道 |
| 🚀 **探测器** | 快速发射 / 收回探测器 |
| 🧪 **星球实验室** | 独立场景搭建天体系统 |

### 天体信息卡片

点击天体后可以：
- 查看名称、类型、质量、直径与轨道参数
- **🔍 详情** —— 打开详情弹窗，含文件夹树形式的资料、图集与**星体关联**（点击关联星体可直接跳转到对应系统并聚焦）
- **🚀 探测器** —— 针对该天体发射探测器
- **🔊 朗读** —— 使用浏览器 TTS 朗读天体介绍

### 社区流程

```
注册 / 登录 → 加入星系 → 在星体数据库或星球实验室创建系统
   ├─ 公民：直接发表 → 审核中 → 开发者审核 → 通过 / 驳回（附意见）
   └─ 开发者 / 管理员：直接发表 → 立即上线
草稿箱 → 个人中心「我的系统」→ 🚀 完成发布
```

- 公民必须先加入目标星系才能投稿；开发者 / 管理员不受此限制
- 「我的系统」汇总你创建的所有系统、审核状态、草稿与指挥官身份
- 消息与资格页签负责接收审核结果、资格领取与各类通知
- 管理员发布「新星系资格」后，公民可在个人中心领取，领取成功立即成为新星系的指挥官

### 管理面板

- **网站管理**（开发者 / 管理员）：添加星系、用户、内容管理、星系管理、星系资格、背景音乐（仅开发者）
- **星系管理**（指挥官）：只看到自己指挥的星系，可编辑星系信息、查看并移除成员
- 用户 / 星系列表均带客户端搜索框；内容管理页签显示待审数量；各行会标记「新」

### 星球实验室

1. 顶部 🧪 打开实验室
2. ➕ 添加星球走四步放置流程，或用 **AI 建造** 描述一套系统
3. 📥 导入星体系统：从数据库复制一整套天体现在实验室
4. 📦 碰撞箱 / 〰 轨迹 / 🗑 擦除 调整调试视图
5. 📤 导出星体系统：选择目标星系 → 保存为草稿 → 到个人中心完成发布

### 语音合成（Python 离线端）

```bash
python voice_handle/voice.py "你好世界"
python voice_handle/voice.py -p dalek --play "EXTERMINATE!"
python voice_handle/voice.py --list          # 查看全部预设
```

依赖（可选）：`pip install -r requirements.txt`（numpy / pyttsx3 / scipy / sounddevice）。

---

## 🔐 权限与数据

### 角色权限

| 能力 | 开发者 | 管理员 | 星系指挥官 | 星际公民 |
|------|:---:|:---:|:---:|:---:|
| 任命 / 撤销管理员、删除账号 | ✅ | — | — | — |
| 封禁 / 解封用户（不能封禁管理员） | ✅ | ✅ | — | — |
| 审核投稿（通过 / 驳回） | ✅ | — | — | — |
| 编辑任意星体系统 | ✅ | —（仅删除） | 自己星系内 | 自己的 |
| 删除任意星体系统 | ✅ | ✅ | 自己的 | 自己的 |
| 发布「新星系资格」 | ✅ | ✅ | — | — |
| 任命 / 撤销星系指挥官 | ✅ | — | — | — |
| 删除宇宙星系 | ✅ | — | — | — |
| 编辑星系信息 / 管理成员 | ✅ | — | 自己指挥的 | — |
| 背景音乐管理 | ✅ | — | — | — |
| 加入星系、领取资格、投稿 | ✅ | ✅ | ✅ | ✅ |

> 界面隐藏按钮只是体验优化，**所有权限都在 `db.py` 服务端重新校验**。

### 数据存储

- 文本数据（含星系图标 SVG、详情文件夹树）全部存在 SQLite `Galaxy/universe.db`
- 图片不入库：贴图写到 `Galaxy/custom/<id>/media/`，详情文件写到 `detail_files/`，数据库只保存仓库相对路径
- `Galaxy/*/data.json`、`Galaxy/universes.json`、`Galaxy/body_relations.json` 为历史备份，前端不再读取
- 浏览器 `localStorage` 只作为离线缓存，并在启动时把本地新建内容回推到服务端

### API 密钥

AI 接口密钥只保存在浏览器 `localStorage`（`stellar_ai_config`），或本地的 `model-chat/key.json`（**已 gitignore，请勿提交**）。它不会出现在任何提示词、消息或日志中。

---

## 📁 项目结构

```
Universe/
├── index.html                     # 应用入口（import map → three / three/addons）
├── index_font/heidong.html        # 黑洞封面动画（GET / 的响应）
├── css/
│   ├── style.css                  # FUI 科幻风格全局样式
│   ├── community.css              # 个人中心 / 管理面板 / 顶部入口布局
│   └── universe.css               # 宇宙视图
├── js/
│   ├── main.js                    # SolarSystemApp 主控类
│   ├── scene.js                   # 渲染器 / 相机 / OrbitControls / 星空 / Bloom
│   ├── physics.js                 # N 体引力引擎
│   ├── constants.js               # G / AU / 缩放 / SIM_DT / SUBSTEPS
│   ├── CelestialBody.js           # 动态天体基类（SI 单位）
│   ├── MoonBody.js                # 运动学卫星基类
│   ├── SystemManager.js           # 每个恒星系统一个 Group，按需挂载
│   ├── galaxyRegistry.js          # 内置系统注册表
│   ├── ui.js                      # 点击交互 / 信息卡片 / 详情弹窗 / 探测器
│   ├── FocusController.js         # 摄像机聚焦追踪
│   ├── FreeFlyController.js       # 自由飞行预览
│   ├── GalaxyBrowser.js           # 星体数据库（列表 / 编译器 / 导入导出）
│   ├── GalaxyPreview.js           # 新建系统时的实时 3D 预览
│   ├── UniverseView.js            # 宇宙视图
│   ├── UniverseRegistry.js        # 宇宙星系数据层（服务端同步 + localStorage 缓存）
│   ├── BodyRelationEditor.js      # 星体关联编辑器
│   ├── DetailTreeEditor.js        # 详情文件夹 / 表面图集编译器
│   ├── PersonalCenter.js          # 个人中心
│   ├── AdminPanel.js              # 网站管理 / 星系管理
│   ├── session.js                 # 会话与 API 客户端（唯一入口）
│   ├── activity.js                # 红点 / 「新」标记的已读状态
│   ├── toast.js                   # 轻提示
│   ├── bgm.js                     # 背景音乐播放器
│   ├── SoundManager.js            # Web Audio 音效
│   ├── voice_settings.js          # 浏览器 TTS + AI 设置界面
│   ├── RoboticVoice.js            # JS 机械音合成
│   └── TimeParticles.js / fuiButtons.js / utils.js / moons.js
├── Galaxy/
│   ├── solar system/              # 太阳系（恒星 + 8 行星 + 14 卫星）
│   ├── hd-219134/                 # HD 219134（恒星 + 6 行星）
│   ├── custom/                    # 用户创建的系统（<id>/media/ 存贴图）
│   └── universe.db                # SQLite（运行时生成，已 gitignore）
├── add-planet/
│   ├── BodyEditor.js              # 星体编辑器
│   ├── PlanetLab.js               # 星球实验室
│   ├── LabAI.js / Blueprint.js    # AI 建造与蓝图换算
│   ├── InfiniteGrid.js            # 着色器无限网格
│   └── PlacementController.js / PlacementHUD.js / PlacementGuides.js
├── ship/js/                       # 飞船状态机 / 舱室模型 / 第一人称 / 全息投影
├── model-chat/                    # 星语终端（overlay + SSE API + 两阶段上下文沙箱）
├── voice_handle/voice.py          # 离线机械音合成器（Python）
├── music/                         # 背景音乐与 index.json
├── detail_files/                  # 详情编译器上传文件（gitignore）
├── db.py                          # SQLite 数据层
├── server.py                      # 静态托管 + REST API（端口 8000）
├── start.py / start.bat           # 一键启动
└── requirements.txt               # 仅离线语音合成需要
```

---

## 📡 服务端 API

`server.py` 只依赖 Python 标准库，端口固定 8000，所有社区写操作都会在 `db.py` 里再次校验权限。

| 分组 | 接口 |
|------|------|
| 会话 | `POST /api/auth/register` · `login` · `logout` · `profile`；`GET /api/auth/me` |
| 星体系统 | `POST /api/list-galaxies` · `create-galaxy` · `update-galaxy` · `publish-system` · `delete-galaxy` · `export-galaxies` · `import-galaxy` |
| 宇宙星系 | `POST /api/list-universe-galaxies` · `save-universe-galaxy` · `delete-universe-galaxy` |
| 星体关联 | `POST /api/list-body-relations` · `save-body-relations`（整表替换） |
| 详情文件 | `POST /api/upload-detail-file`；`GET /detail_files/<name>` |
| 社区 | `POST /api/my-systems` · `my-memberships` · `galaxy/join` · `galaxy/leave` · `galaxy/members` · `galaxy/kick` |
| 资格与通知 | `POST /api/offers/list` · `publish` · `claim` · `cancel`；`/api/messages` · `/api/messages/read` |
| 管理 | `POST /api/review-system` · `/api/admin/systems` · `users` · `set-role` · `set-banned` · `delete-user` · `set-commander` · `list-bgm` · `upload-bgm` · `delete-bgm` |
| 迁移 | `POST /api/migrate-local-data` |

> 角色守卫：`_need_user`（登录）、`_need_staff`（开发者或管理员）、`_need_developer`（仅开发者）。

---

## 🔧 扩展开发

### 添加一个内置恒星系统

1. 新建 `Galaxy/<id>/index.js`，导出 `SYSTEM_INFO`、`PLANET_CLASSES`、`PLANET_DATA`、`SYSTEM_POS`、`MOON_CLASSES`、`createPlanets`
2. 每个天体一个类文件，静态字段：`KEY / NAME / NAME_CN / MASS / RADIUS / ORBIT_RADIUS / VISUAL_RADIUS / COLOR / TEXTURE / DETAILS / VOICE_INTRO`（`ORBIT_RADIUS` 为米，`VISUAL_RADIUS` 为场景单位）
3. 在 `js/galaxyRegistry.js` 里 import 并加入 `SYSTEM_MODULES`
4. 在 `js/main.js` 里调用 `systemManager.registerModule(...)`
5. 若导出 `MOON_CLASSES`，同时在 `model-chat/js/context.js` 的 `BUILTIN_MOONS` 中登记，AI 才能看到卫星

详细字段说明见 [Galaxy-模块标准模板.md](Galaxy-模块标准模板.md) 与 [ADDXINGXI.md](ADDXINGXI.md)。

### 单位约定（最容易出错的地方）

- 物理引擎全程 **SI 单位**（kg / m / s）；渲染坐标 = SI 位置 × `POS_SCALE × SYSTEM_SCALE`
- `ORBIT_RADIUS`（天体类）是米；`MoonBody.ORBIT_RADIUS` 与 `VISUAL_RADIUS` 是场景单位，构造时再乘 `SYSTEM_SCALE`
- 删除天体时要同时从场景 / Group 与物理引擎移除并释放资源，`CSS2DObject` 标签也需要显式销毁

### 缓存与版本号

项目没有打包器，浏览器缓存靠手写 `?v=` 查询串。改动某个入口模块或样式后请同步提升 `index.html` / 各 import 处的版本号；**同一个模块在所有位置必须使用相同的 `?v=`**，否则会被实例化两次（会话状态会分裂）。

---

## 💻 技术栈

| 技术 | 用途 |
|------|------|
| **Three.js 0.160** | WebGL 3D 渲染（CDN + import map） |
| **ES Modules** | 无打包前端架构 |
| **Python 3 标准库** | 静态托管 + REST API |
| **SQLite** | 系统 / 星系 / 关联 / 详情 / 账号 / 消息等文本数据 |
| **ShaderMaterial** | 星空、星云、无限网格 |
| **EffectComposer** | Bloom 泛光后处理 |
| **PointerLockControls** | 飞船与自由飞行 |
| **Web Audio API / SpeechSynthesis** | 音效、背景音乐、语音朗读 |
| **SSE** | AI 流式对话 |
| **NumPy / SciPy** | Python 端离线音频 DSP |

---

## ⚠️ 已知限制

- `server.py` 是**本地开发服务器**：绑定 `0.0.0.0:8000`、无 TLS、静态文件不做鉴权（会话只保护 `/api/*`）。请勿直接暴露到不可信网络；正式部署需要 HTTPS、反向代理与静态资源访问控制。
- 前端依赖 jsDelivr 加载 Three.js，离线环境需要自行将依赖放到本地并改写 import map。
- 项目没有单元测试 / Lint / 构建命令，改动请在浏览器中手动验证。

---

## 📄 许可

本项目为个人开源作品，仅供学习交流使用。见 [LICENSE](LICENSE)。

---

> 🌠 **探索星辰大海，从 Starry Sky Universe 开始。**
