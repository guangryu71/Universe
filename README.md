🌌 项目全景分析报告：Starry Sky Universe
一、项目概览
这是一个基于 Three.js 的 3D 交互式宇宙模拟器，包含完整的 N 体引力物理引擎、多个可切换的恒星系统、飞船漫游系统、AI 对话终端、星体编辑器和星球实验室。项目采用ES Module 模块化架构，运用纯客户端 Web 技术构建了一个沉浸式的科幻宇宙交互体验。

二、目录结构意图

Universe/
├── index.html                 # ▶ 单页应用入口，所有功能通过此页访问
├── css/style.css              # FUI 科幻风格全局样式
├── js/                        # ◈ 核心逻辑层
│   ├── main.js                #   应用入口（SolarSystemApp 主控类）
│   ├── scene.js               #   Three.js 场景/相机/星空着色器
│   ├── physics.js             #   物理引擎（N体引力）
│   ├── SystemManager.js       #   多恒星系统切换
│   ├── CelestialBody.js       #   天体基类（万物起源）
│   ├── FocusController.js     #   摄像机聚焦追踪
│   ├── GalaxyBrowser.js       #   星系浏览器 UI
│   ├── galaxyRegistry.js      #   星系注册表（数据层）
│   └── ...                    #   SoundManager, RoboticVoice 等
├── Galaxy/                    # ★ 星系数据层（模块化）
│   ├── solar system/          #   太阳系模块（9星+14卫）
│   ├── hd-219134/             #   系外行星系统
│   └── custom/                #   用户自定义星系（动态生成）
├── add-planet/                # 🔧 添加星体工具集
│   ├── BodyEditor.js          #   可视化星体编辑器
│   └── PlanetLab.js           #   独立星球实验室
├── ship/                      # 🚀 飞船系统
│   └── js/
│       ├── ShipModule.js      #   飞船协调器
│       ├── ShipModel.js       #   舱室3D模型
│       ├── PlayerController.js#   第一人称控制
│       └── Hologram.js        #   全息UI
├── model-chat/                # 🤖 AI 对话终端
│   └── js/
│       ├── overlay.js         #   嵌入式覆盖层
│       ├── api.js             #   SSE 流式 API
│       └── login.js           #   密码验证
├── server.py                  # 📡 Python HTTP 服务器（REST API）
├── music/                     # ♫ 背景音乐
└── soundEffects/              # 🔊 音效（按钮/探测器/打字机）
三、前端设计与视觉风格
3.1 设计语言：FUI（科幻用户界面）
配色：深空背景（#000008）+ 青色高亮（#00f3ff）+ 霓虹蓝绿光晕
字体：Orbitron（数字显示）+ Rajdhani（正文）+ Share Tech Mono（终端文字）
视觉元素：
裁剪多边形装饰（clip-path: polygon(…)）
边角发光指示线（::after 伪元素）
CRT 扫描线覆盖层
glitch 故障动画效果
全息投影式数据面板
3.2 元素布局

┌──────────────────────────────────────────────────────────┐
│  [FUI 按钮工具栏]  BGM │ 对话 │ 添加 │ 设置 │ 飞船 │ 浏览器│
│  [FUI 数据面板 - 打字机显示]                                │
│                                                            │
│                  ★ 3D 场景（Three.js）                      │
│             着色器星空 · 星体 · 轨道线                       │
│                                                            │
│  [星球卡片 - 悬浮]      [探测器计算弹窗]                    │
│                                                            │
│  [简介卡片 (10s后消失)]      [时间流速控制]  [视角切换]    │
│  ────────────────────────────  ◄ 底部 HUD                  │
└──────────────────────────────────────────────────────────┘
坐标系统：所有 UI 使用 position: fixed 定位，3D 场景填满全屏在 z-index: 1，UI 元素在 z-index: 10-999999。

四、技术实现深度分析
4.1 三维引擎（js/scene.js）
技术	说明
Three.js 0.160	核心 WebGL 渲染框架
OrbitControls	中指旋转 / 左键平移 / 滚轮缩放
ShaderMaterial	自定义着色器渲染12万+6万颗恒星，含：光谱色分布(OBAFGKM)、衍射十字光晕、闪烁动画
EffectComposer	Bloom 泛光后处理（strength=0.25, radius=0.8, threshold=0.3）
FogExp2	指数雾增强景深感
CanvasTexture	程序化生成星云背景（多层径向渐变）
4.2 物理引擎（js/physics.js）
算法：Velocity Verlet 积分法（能量守恒）
子步数：4 步/帧（提高精度）
复杂度：O(n²) 两两引力计算（适合 < 100 天体）
常量体系：真实物理常量（G=6.67430e-11, AU=1.496e11m）
缩放：POS_SCALE = 22/AU，SYSTEM_SCALE=20（视觉放大）
4.3 多系统切换（js/SystemManager.js）
每个恒星系统是一个独立的 THREE.Group
切换时：隐藏旧系统 → 从场景移除 → 显示新系统 → 同步物理引擎
模块注册制：registerModule(id, createPlanetsFn, moonClasses)
天体 Mesh 被从主场景移到系统 Group 内
4.4 天体模型（js/CelestialBody.js）
贴图系统：优先加载真实 .jpg 贴图 → 失败后回退 Canvas 生成程序化纹理
物理状态：position / velocity / acceleration 在 SI 单位下运算
位置同步：_syncMeshPosition() 将物理坐标 × POS_SCALE × SYSTEM_SCALE → 3D 场景坐标
圆形轨道速度：setCircularOrbitVelocity(centralMass)
4.5 卫星系统（js/MoonBody.js + js/moons.js）
卫星使用独立的 MoonBody 基类（非 CelestialBody）
卫星绕母行星做圆周运动，由 updateMoons() 每帧更新
4.6 音效与语音
SoundManager：Web Audio API + AudioBuffer 预加载，支持变调（detune）、方向音效（正反向滑块声）、合成打字机音效
RoboticVoice：完整的机械音合成器——脉冲震荡源 → 共振峰滤波 → 位深压缩 → 采样率降低 → 带通滤波 → 失真 → 颤音 → 梳状滤波/回声
TTS 桥接：Fallback 链：Edge TTS（原生 SpeechSynthesis）→ RoboticVoice JS 合成
4.7 AI 对话终端（model-chat/）
密码验证登录 → SSE 流式对话（DeepSeek Flash 模型）
支持系统提示词自定义、语音朗读、设置管理
使用 sessionStorage 记住登录状态
4.8 飞船系统（ship/）
PointerLockControls 实现第一人称室内漫游
ShipModule 状态机：universe → entering → ship → exiting
Tween 动画实现进出舱室平滑过渡
全息投影 UI 显示天体数据，warpToBody() 跃迁
4.9 后端（server.py）
Python 内置 http.server，端口 8000
REST API：POST /api/list-galaxies / create-galaxy / delete-galaxy
自动生成星系模块文件到 Galaxy/custom/<id>/
五、业务逻辑与交互流程
5.1 核心流程

页面加载 → 初始化SolarSystemApp → 注册星系模块 → 加载太阳系 → 启动动画循环

动画循环：
  ① physics.step() — 模拟半天物理
  ② 同步所有天体 mesh 位置
  ③ 更新卫星位置
  ④ 更新飞船模块（若激活）
  ⑤ 更新聚焦追踪
  ⑥ 更新探测器
  ⑦ 天体自转
  ⑧ sceneManager.render()
5.2 用户交互流程

[右键菜单] → 跃迁到星球
[中键拖拽] → 旋转视角
[左键平移] → 平移场景
[滚轮缩放] → 拉近/拉远
[点击星球] → 聚焦追踪 + 弹出信息卡片
[时间滑块] → 调整模拟速度 (log 范围)
[视角 XY/XZ/YZ] → 标准正交视图
[星系浏览器] → 搜索/切换恒星系统 | 创建新星系
[添加星体] → 可视化放置（XZ→Y→速度方向→速度仰角）
[发射探测器] → 自动计算拦截轨道 | 手动十字准星瞄准
[飞船按钮] → 进入舱室（第一人称）→ 全息投影 → 跃迁
[AI对话] → 密码登录 → 流式对话（带TTS朗读）
[星球实验室] → 独立场景创建/编辑/碰撞箱测试
六、模块依赖关系

index.html
  ├── css/style.css (FUI 样式)
  ├── ship/css/ship.css (飞船样式)
  ├── js/fuiButtons.js (按钮打字机特效 — 独立)
  └── js/main.js (ES Module 入口)
        ├── js/scene.js      ←── three.js / OrbitControls / EffectComposer
        ├── js/physics.js    ←── constants.js (G, SUBSTEPS)
        ├── js/constants.js  (G, AU, DAY, POS_SCALE, SYSTEM_SCALE...)
        ├── js/ui.js         ←── utils.js, constants.js
        ├── js/CelestialBody.js ←── constants.js, THREE
        ├── js/MoonBody.js   ←── THREE
        ├── js/SystemManager.js ←── moons.js
        ├── js/FocusController.js ←── galaxyRegistry.js
        ├── js/GalaxyBrowser.js ←── galaxyRegistry.js, CelestialBody.js
        ├── js/galaxyRegistry.js ←── Galaxy/*/index.js, utils.js
        ├── js/moons.js      ←── Galaxy/*/index.js (MOON_CLASSES)
        ├── js/SoundManager.js
        ├── js/bgm.js
        ├── js/RoboticVoice.js
        ├── js/voice_settings.js
        ├── js/TimeParticles.js
        ├── add-planet/BodyEditor.js ←── PlacementHUD, PlacementGuides
        ├── add-planet/PlanetLab.js  ←── 独立的 Three.js 场景
        ├── ship/js/bridge.js → ShipModule.js
        │     ├── ShipModel.js, PlayerController.js, Hologram.js
        ├── model-chat/js/overlay.js ←── config.js, api.js, voice_settings.js
        └── Galaxy/*/index.js (星系数据 + createPlanets 工厂函数)
七、数据流向

┌──────────────────────────────────────────────────────────────┐
│                        galaxyRegistry.js                      │
│  ┌──────────────────────┐   ┌──────────────────────────────┐ │
│  │ 内置星系（静态 import）│   │ 自定义星系（localStorage +   │ │
│  │ solar system,         │   │ 服务器 API -> Galaxy/custom/ │ │
│  │ hd-219134             │   │ data.json）                  │ │
│  └────────┬─────────────┘   └────────┬─────────────────────┘ │
│           ▼                          ▼                       │
│      getAllGalaxies() / searchGalaxies()                      │
└───────────┬──────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────┐
│                       SystemManager                           │
│   switchTo(id) → 加载模块 → createPlanets() → 创建 THREE.Group│
│   → 隐藏旧组 → 显示新组 → 同步 physics.bodies                 │
└───────────┬──────────────────────────────────────────────────┘
            │
            ▼  (this.physics.bodies)
┌──────────────────────────────────────────────────────────────┐
│                     PhysicsEngine                             │
│   bodies[] = [Sun, Mercury, Earth, ...]                       │
│   step(dt) → Velocity Verlet → 更新所有 body.position/velocity│
│   → 外部循环调用 _syncMeshPosition() → 更新 3D 坐标            │
└───────────┬──────────────────────────────────────────────────┘
            │
            ▼  (同步后的 mesh.position)
┌──────────────────────────────────────────────────────────────┐
│                   FocusController                             │
│   focusBody(body) → 计算 offset → 每帧追踪 mesh.position     │
│   → 更新 camera.position/rotation                            │
├──────────────────────────────────────────────────────────────┤
│                    UIManager                                  │
│   点击射线检测 → _showCard() → 详情弹窗 → 探测器发射          │
├──────────────────────────────────────────────────────────────┤
│                    ShipModule                                 │
│   enterShip() → tween 进舱 → PointerLock → Hologram → 跃迁    │
└──────────────────────────────────────────────────────────────┘
八、扩展系统与模板化设计
项目设计了完整的模块化星系模板标准（详见 Galaxy-模块标准模板.md 和 ADDXINGXI.md）：

星系模块规范：每个 Galaxy/<id>/index.js 必须导出：

SYSTEM_INFO — 元数据
PLANET_DATA — 静态数据数组
createPlanets(scene) — 工厂函数
MOON_CLASSES — 卫星类映射
添加方式：

手动创建模块文件到 Galaxy/ 目录
通过 UI 浏览器点击 "添加星系" 按钮，填写表单
服务器端自动生成 Galaxy/custom/<id>/index.js + data.json
持久化：自定义星系保存在 localStorage + 服务器文件系统

九、总结
维度	评价
架构设计	优秀的 ES Module 分层架构，关注点分离清晰（数据/逻辑/渲染/UI）
技术深度	Three.js 着色器、N体物理引擎、DSP音效合成、SSE流式通信，纯前端实现
用户体验	沉浸式 FUI 设计，CRT 特效、glitch 动画、全息投影、打字机音效
扩展性	星系模块标准化、注册制、工厂模式，方便添加新系统
可维护性	每文件都有明确的头部注释说明职责，代码组织规整
创新点	① 联合 RoboticsVoice TTS ② 史瓦西半径→黑洞创建 ③ 探测器拦截计算 ④ 星球实验室
