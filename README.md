# 🌌 Starry Sky Universe

**一个基于 Three.js 的 3D 交互式宇宙模拟器** — 包含完整的 N 体引力物理引擎、多恒星系统切换、飞船漫游系统、AI 对话终端、星体编辑器与星球实验室。

## 📋 目录

- [项目介绍](#-项目介绍)
- [功能总览](#-功能总览)
- [技术架构](#-技术架构)
- [部署流程](#-部署流程)
- [使用说明书](#-使用说明书)
- [项目结构](#-项目结构)
- [扩展开发](#-扩展开发)
- [技术栈](#-技术栈)

---

## 🌟 项目介绍

Starry Sky Universe 是一个沉浸式科幻宇宙交互平台，采用纯前端 Web 技术构建。用户可以在三维空间中漫游太阳系、探索系外行星系统 HD 219134、创建自定义星系、发射探测器、驾驶飞船跃迁，甚至与 AI 助手进行语音对话。

### 核心特色

| 特性 | 说明 |
|------|------|
| **沉浸式 3D 场景** | 12万+6万颗着色器渲染恒星、Bloom 泛光、指数雾、程序化星云 |
| **真实物理引擎** | N 体引力模拟 (Velocity Verlet 积分)，使用真实物理常量 (G, AU) |
| **多恒星系统** | 支持太阳系、HD 219134 等系统一键切换，模块化注册制 |
| **飞船系统** | 第一人称舱内漫游，全息投影 UI，星际跃迁 |
| **AI 对话终端** | SSE 流式对话，7 种机械电子音预设，语音朗读 |
| **星体编辑器** | 可视化放置星体（XZ→Y→速度方向→仰角），实时物理模拟 |
| **星球实验室** | 独立 3D 场景创建/编辑天体，碰撞箱测试，轨迹追踪 |
| **自定义星系** | UI 表单创建星系，REST API 持久化，导出/导入 |
| **探测器系统** | 自动拦截轨道计算 / 手动十字准星瞄准发射 |
| **FUI 科幻界面** | 全息投影、CRT 扫描线、glitch 故障动画、打字机音效 |

---

## 🎯 功能总览

### 1. 三维场景漫游
- **视角控制**：鼠标中键旋转 · 左键平移 · 滚轮缩放
- **标准视图**：一键切换到 XY / XZ / YZ 正交视角
- **星球聚焦**：点击星球 → 卫星式追踪 + 信息卡片弹出
- **右键菜单**：快速跃迁到目标星球

### 2. 物理模拟
- N 体引力引擎（Velocity Verlet 积分法，4 子步/帧）
- 真实物理常数（G = 6.67430×10⁻¹¹，AU = 1.496×10¹¹ m）
- 实时轨道绘制，天体精确位置同步
- 时间流速可调（对数滑块 1–100x）

### 3. 星空背景
- 12 万颗主星（OBAFGKM 光谱色分布）+ 6 万颗暗星
- 衍射十字光晕、闪烁动画、程序化星云

### 4. 星系浏览器
- 内置星系：**太阳系**（8 行星 + 14 卫星）、**HD 219134**（7 系外行星）
- 新建星系：通过表单填写星体数据
- 搜索、切换、删除星系
- 星系数据导出/导入（ZIP 打包）

### 5. 飞船系统
- 第一人称舱内漫游（PointerLockControls）
- 全息投影天体数据面板
- warpToBody() 跃迁动画
- Tween 进出舱室平滑过渡

### 6. AI 对话终端
- 密码验证登录（sessionStorage 持久化）
- SSE 流式对话（支持 DeepSeek 等 API）
- 自定义系统提示词
- 机械电子音 TTS 朗读（7 种预设风格）
- 字幕显示、设置管理

### 7. 机械电子音合成器
双引擎实现（JS 浏览器端 + Python 离线端）：

| 预设 | 风格 |
|------|------|
| `ai_assistant` | AI 助手音（默认） |
| `classic_robot` | 经典机器人 |
| `dalek` | Daleks 激进风格 |
| `glitch_ai` | 故障 AI |
| `subtle_cyborg` | 轻度赛博格 |
| `old_radio` | 老式收音机 |
| `deep_mech` | 低沉机械 |

### 8. 星体编辑器
- 四步可视化放置：XZ 定位 → Y 高度 → 水平速度方向 → 速度仰角
- 实时显示坐标和角度
- 放置后自动加入物理模拟

### 9. 星球实验室
- 独立 Three.js 场景，与主场景隔离
- 完整 BodyEditor 复用流程
- 碰撞箱可视化、轨迹线追踪
- 自定义物理参数调整

### 10. 音效系统
- Web Audio API 预加载音效缓存
- 变调合成（滑块声、打字机声、探测器声等）
- 背景音乐播放器（9 首曲目循环/随机）
- 3D 定向音效

---

## 🏗 技术架构

```
index.html
  ├── css/style.css         — FUI 科幻风格样式
  ├── ship/css/ship.css     — 飞船舱室样式
  └── js/main.js (ES Module 入口)
        ├── js/scene.js           — Three.js 场景/相机/星空着色器/Bloom
        ├── js/physics.js         — N 体引力物理引擎 (Velocity Verlet)
        ├── js/constants.js       — G, AU, DAY, POS_SCALE, SYSTEM_SCALE
        ├── js/ui.js              — 点击交互、信息卡片、探测器弹窗
        ├── js/CelestialBody.js   — 天体基类
        ├── js/MoonBody.js        — 卫星基类
        ├── js/SystemManager.js   — 多恒星系统切换
        ├── js/FocusController.js — 摄像机聚焦追踪
        ├── js/GalaxyBrowser.js   — 星系浏览器 UI
        ├── js/galaxyRegistry.js  — 星系数据注册表
        ├── js/moons.js           — 卫星控制器
        ├── js/bgm.js             — 背景音乐
        ├── js/SoundManager.js    — 音效管理 (Web Audio API)
        ├── js/RoboticVoice.js    — 机械电子音合成 (JS 引擎)
        ├── js/voice_settings.js  — TTS 设置管理
        ├── js/TimeParticles.js   — 时间流速粒子特效
        ├── add-planet/
        │   ├── BodyEditor.js     — 可视化星体编辑器
        │   ├── PlanetLab.js      — 星球实验室
        │   ├── PlacementController.js — 放置状态机
        │   └── PlacementHUD.js   — 放置 HUD
        ├── ship/js/
        │   ├── ShipModule.js     — 飞船状态机
        │   ├── ShipModel.js      — 舱室 3D 模型
        │   ├── PlayerController.js — 第一人称控制
        │   └── Hologram.js       — 全息投影 UI
        ├── model-chat/js/
        │   ├── overlay.js        — AI 对话覆盖层
        │   ├── api.js            — SSE 流式 API
        │   ├── login.js          — 密码验证
        │   └── config.js         — 配置管理
        └── Galaxy/
            ├── solar system/     — 太阳系模块 (9 星 + 14 卫)
            ├── hd-219134/        — 系外行星系统
            └── custom/           — 用户自定义星系
```

---

## 🚀 部署流程

### 方式一：快速启动（推荐）

```bash
# 1. 克隆仓库
git clone https://gitee.com/super-dog_1/starry-sky.git
cd Universe

# 2. 直接打开 HTML
#    双击 index.html 或在浏览器中打开即可使用
#    （部分功能需要 HTTP 服务器支持）
```

### 方式二：完整部署（含星系持久化 API）

```bash
# 1. 克隆仓库
git clone https://gitee.com/super-dog_1/starry-sky.git
cd Universe

# 2. （可选）创建 Python 虚拟环境
python -m venv .venv

# 3. 安装 Python 依赖
#    基础版（仅服务器）：
pip install -r requirements.txt

#    完整版（含语音合成）：
pip install numpy pyttsx3 scipy sounddevice

# 4. 一键启动
#    Windows:
start.bat

#    或手动启动：
python start.py

# 5. 打开浏览器访问
#    http://127.0.0.1:8000
```

### 方式三：静态服务器部署

```bash
# 使用任意 HTTP 服务器
python -m http.server 8000
# 或
npx serve .
```

### 方式四：生产环境（Nginx）

```nginx
server {
    listen 80;
    server_name universe.example.com;
    root /path/to/Universe;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 系统要求

| 组件 | 要求 |
|------|------|
| 浏览器 | Chrome 90+ / Edge 90+ / Firefox 90+（需支持 WebGL 2.0） |
| Python | 3.8+（仅星系持久化和语音合成需要） |
| 网络 | 首次加载需 CDN 下载 Three.js（约 2MB） |
| 显卡 | 支持 WebGL 2.0 的独立显卡或集成显卡 |
| 内存 | 建议 4GB+（含 3D 场景渲染） |

---

## 📖 使用说明书

### 启动与访问

1. 按照上方部署流程启动项目
2. 访问 `http://127.0.0.1:8000`（或直接打开 index.html）
3. 页面加载后，你将看到沉浸式 3D 宇宙场景

### 基础操作

| 操作 | 鼠标/键盘 | 说明 |
|------|-----------|------|
| 旋转视角 | 鼠标中键拖拽 | 围绕场景中心旋转 |
| 平移场景 | 鼠标左键拖拽 | 上下左右平移 |
| 缩放 | 鼠标滚轮 | 拉近/拉远视角 |
| 聚焦星球 | 左键点击星球 | 摄像机自动追踪，弹出信息卡片 |
| 取消聚焦 | 点击卡片关闭按钮 / 按 `Esc` | 恢复自由视角 |
| 标准视图 | 点击 XY / XZ / YZ 按钮 | 切换到正交视角 |
| 时间加速 | 拖动时间表盘 / 时间滑块 | 调整模拟速度（对数范围） |

> **提示**：启动后会显示操作提示卡片，10 秒后自动消失。可在任意时刻点击「❓」按钮重新查看。

### 功能区介绍

#### 🔭 顶部工具栏

| 按钮 | 功能 |
|------|------|
| 🎵 **BGM** | 背景音乐播放控制（播放/暂停/上一首/下一首） |
| 💬 **对话** | 打开 AI 对话终端面板 |
| ➕ **添加** | 进入星体可视化放置模式 |
| ⚙️ **设置** | TTS 语音合成设置、自定义参数 |
| 🚀 **飞船** | 进入飞船舱室第一人称模式 |
| 🌐 **浏览器** | 打开星系浏览器（搜索/切换/创建/删除星系） |

#### 星球信息卡片

点击任意星球弹出信息卡片：
- 星球名称、类型、质量、直径
- 与恒星距离（光分/光时/光年）
- **🔍 详情** — 打开详细数据弹窗（含轨道参数）
- **🚀 探测器** — 进入探测器发射界面
- **🔊 朗读** — 机械电子音朗读星球信息

#### 探测器系统

1. 点击星球 → 点击「🚀 探测器」按钮
2. 选择模式：
   - **自动计算** — 自动计算最佳拦截轨道并发射
   - **手动瞄准** — 使用十字准星瞄准，点击发射
3. 点击「📡 收回」召回探测器

#### 飞船系统

1. 点击「🚀 飞船」按钮 → 摄像机飞向舱室
2. 进入第一人称模式（鼠标控制视角，WASD 移动）
3. 全息投影面板显示附近天体数据
4. 选择目标星球 → 点击「跃迁」→ 飞船穿越到目标
5. 按 `Esc` 退出飞船模式

#### AI 对话终端

1. 点击「💬 对话」按钮 → 弹出覆盖层
2. 首次使用需要输入密码登录（sessionStorage 记住状态）
3. 在输入框输入问题，按回车发送
4. AI 回复以打字机效果逐字显示
5. 自动或点击「🔊」按钮朗读回复
6. 在设置面板中可更换系统提示词和语音参数

#### 星系浏览器

1. 点击「🌐 浏览器」按钮 → 打开星系列表
2. 浏览内置星系（太阳系、HD 219134）和自定义星系
3. **搜索** — 输入星系名称快速定位
4. **切换** — 点击星系卡片，3D 场景自动切换
5. **添加星系** — 填写表单创建新星系（名称、恒星参数、行星列表等）
6. **删除星系** — 仅可删除自定义星系

#### 星体编辑器

1. 点击「➕ 添加」按钮
2. 按照 HUD 提示四步操作：
   - ① 在 XZ 平面上移动定位
   - ② 调整 Y 轴高度
   - ③ 选择水平速度方向
   - ④ 调整速度仰角
3. 点击确认放置 → 新星体加入物理模拟

#### 星球实验室

1. 在星系浏览器底部点击「🔬 星球实验室」
2. 在独立场景中创建、编辑天体
3. 开启「碰撞箱」可视化碰撞检测
4. 开启「轨迹」追踪天体运动轨迹
5. 支持场景保存和导出

### 自定义星系（通过 REST API）

项目自带 HTTP 服务器，提供星系管理 API：

```bash
# 列出所有星系
curl http://127.0.0.1:8000/api/list-galaxies

# 创建新星系
curl -X POST http://127.0.0.1:8000/api/create-galaxy \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Galaxy",
    "nameCN": "我的星系",
    "star": {"name": "Alpha", "mass": 1.989e30, "radius": 6.96e8, "temperature": 5778},
    "planets": [
      {"name": "Planet A", "mass": 5.97e24, "radius": 6.37e6, "orbitRadius": 1.5e11}
    ]
  }'

# 删除星系
curl -X POST http://127.0.0.1:8000/api/delete-galaxy \
  -H "Content-Type: application/json" \
  -d '{"id": "galaxy_1234567890"}'

# 导出星系（ZIP）
curl -X POST http://127.0.0.1:8000/api/export-galaxies \
  -H "Content-Type: application/json" \
  -d '{"ids": ["galaxy_1234567890"]}'

# 导入星系（ZIP）
curl -X POST http://127.0.0.1:8000/api/import-galaxy \
  --data-binary @galaxies_export_1234567890.zip
```

### 语音合成（独立使用）

Python 端机械电子音合成器可独立使用：

```bash
# 基础合成
python voice_handle/voice.py "你好，我是人工智能助手"

# 选择预设风格
python voice_handle/voice.py -p dalek "EXTERMINATE!"
python voice_handle/voice.py -p glitch_ai -o output.wav "系统故障"

# 合成并播放
python voice_handle/voice.py --play "你好世界"
python voice_handle/voice.py --play-save -p dalek "你好"

# 列出所有预设
python voice_handle/voice.py --list
```

Python API 调用：

```python
from voice_handle.voice import synthesize, speak

# 合成并保存
synthesize("你好", preset="dalek")

# 合成并播放
speak("你好世界", preset="glitch_ai", save=True)
```

---

## 📁 项目结构

```
Universe/
├── index.html                     # ▶ 单页应用入口
├── css/
│   ├── style.css                  # FUI 科幻风格全局样式
│   └── (其他样式文件)
├── js/                            # ◈ 核心逻辑层
│   ├── main.js                    #   应用入口 (SolarSystemApp 主控类)
│   ├── scene.js                   #   Three.js 场景/相机/星空着色器
│   ├── physics.js                 #   N体引力物理引擎
│   ├── ui.js                      #   点击交互与信息卡片
│   ├── constants.js               #   物理常量与格式化工具
│   ├── CelestialBody.js           #   天体基类
│   ├── MoonBody.js                #   卫星基类
│   ├── SystemManager.js           #   多恒星系统切换
│   ├── FocusController.js         #   摄像机聚焦追踪
│   ├── GalaxyBrowser.js           #   星系浏览器 UI
│   ├── galaxyRegistry.js          #   星系注册表
│   ├── moons.js                   #   卫星控制器
│   ├── bgm.js                     #   背景音乐播放器
│   ├── SoundManager.js            #   音效管理器 (Web Audio API)
│   ├── RoboticVoice.js            #   机械电子音合成器 (JS)
│   ├── voice_settings.js          #   TTS 语音设置
│   ├── TimeParticles.js           #   时间粒子特效
│   ├── fuiButtons.js              #   FUI 按钮特效
│   └── utils.js                   #   工具函数
├── Galaxy/                        # ★ 星系数据层
│   ├── solar system/              #   太阳系 (9星 + 14 卫星)
│   │   ├── index.js               #   模块入口
│   │   ├── data.json              #   天体数据
│   │   ├── Sun.js, Earth.js, ...  #   各天体类
│   │   └── planets/               #   贴图资源
│   ├── hd-219134/                 #   系外行星系统
│   │   ├── index.js               #   模块入口
│   │   ├── data.json              #   天体数据
│   │   └── HD219134*.js           #   各天体类
│   └── custom/                    #   用户自定义星系
├── add-planet/                    # 🔧 添加星体工具集
│   ├── BodyEditor.js              #   可视化星体编辑器
│   ├── PlanetLab.js               #   星球实验室
│   ├── PlacementController.js     #   放置状态机
│   ├── PlacementHUD.js            #   HUD 显示
│   ├── PlacementGuides.js         #   辅助线/网格
│   └── BlackHoleEffect.js         #   黑洞特效
├── ship/                          # 🚀 飞船系统
│   ├── 飞船.html                  #   飞船入口
│   └── js/
│       ├── bridge.js              #   导出桥接
│       ├── ShipModule.js          #   飞船状态机
│       ├── ShipModel.js           #   舱室 3D 模型
│       ├── PlayerController.js    #   第一人称控制
│       └── Hologram.js            #   全息投影 UI
├── model-chat/                    # 🤖 AI 对话终端
│   ├── index.html                 #   独立入口
│   ├── css/terminal.css           #   终端样式
│   └── js/
│       ├── overlay.js             #   嵌入式覆盖层
│       ├── api.js                 #   SSE 流式 API
│       ├── login.js               #   密码验证
│       ├── config.js              #   配置管理
│       ├── main.js                #   主逻辑
│       ├── chat.js                #   聊天交互
│       └── key.json               #   登录密码
├── voice_handle/                  # 🎙 语音合成 (Python)
│   └── voice.py                   #   机械电子音合成器
├── music/                         # ♫ 背景音乐 (MP3)
│   └── index.json                 #   播放列表
├── special-effects/               # ✨ 特效页面
│   └── 穿越.html                  #   穿越动画
├── index_font/                    # 📄 封面页面
│   └── heidong.html               #   黑洞封面
├── server.py                      # 📡 HTTP 服务器 (REST API)
├── start.py                       # ▶ 一键启动器
├── start.bat                      # ▶ Windows 一键启动
├── requirements.txt               # Python 依赖
└── README.md                      # 本文件
```

---

## 🔧 扩展开发

### 添加新星系（模块化标准）

按照 [Galaxy-模块标准模板.md](Galaxy-模块标准模板.md) 创建新星系模块：

```javascript
// Galaxy/my-system/index.js
export const SYSTEM_INFO = { id: 'my-system', name: 'My System' };
export const PLANET_DATA = [ /* ... */ ];
export const MOON_CLASSES = {};

export function createPlanets(scene, ep) {
    const bodies = {};
    // 创建 CelestialBody 实例并添加到 scene / ep
    return bodies;
}
```

### 注册到系统

在 `js/main.js` 中注册：

```javascript
import * as mySystem from '../Galaxy/my-system/index.js';
this.systemManager.registerModule('my-system', mySystem.createPlanets, mySystem.MOON_CLASSES);
```

### 主题定制

- **配色方案**：修改 `css/style.css` 中的 CSS 变量（`--cyan`, `--purple` 等）
- **字体**：替换 Google Fonts 引用（Orbitron / Rajdhani / Share Tech Mono）
- **星空密度**：修改 `js/scene.js` 中 `createStars()` 的粒子数量参数

---

## 💻 技术栈

| 技术 | 用途 |
|------|------|
| **Three.js 0.160** | 3D 渲染引擎（WebGL） |
| **ES Modules** | 前端模块化架构 |
| **Python 3** | HTTP 服务器 + REST API |
| **Web Audio API** | 音效合成与播放 |
| **SpeechSynthesis API** | 浏览器 TTS |
| **SSE (Server-Sent Events)** | 流式 AI 对话 |
| **ShaderMaterial** | 自定义星空着色器 |
| **EffectComposer** | Bloom 泛光后处理 |
| **PointerLockControls** | 飞船第一人称控制 |
| **NumPy / SciPy** | Python 端音频 DSP |

---

## 📄 许可

本项目为个人开源作品，仅供学习交流使用。

---

> 🌠 **探索星辰大海，从 Starry Sky Universe 开始。**
