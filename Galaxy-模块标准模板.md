# Galaxy 单恒星系统模块标准模板

## 目录结构规范

```
Galaxy/<system-id>/
  index.js              # 模块入口（必须）
  <ClassName>Star.js    # 恒星文件（每个系统1个）
  <ClassName>b.js       # 行星文件（每个行星1个）
  <ClassName>c.js       # ...
  <planet>_<moon>.js    # 卫星文件（命名: 母行星_卫星名）
  planets/
    2k/                 # 贴图文件（可选）
```

---

## 1. 独立星体文件模板

每个星体一个文件，统一格式如下（以 `Galaxy/hd-219134/HD219134b.js` 为蓝本）：

```js
// ============================================================
// <FileName>.js — <显示名称>（<所属系统>）
// ============================================================

import { CelestialBody } from '../../js/CelestialBody.js';

export class <ClassName> extends CelestialBody {

    static KEY           = '<唯一标识>';
    static NAME          = '<中文名>';
    static NAME_CN       = '<英文名>';
    static MASS          = <质量，单位 kg>;        // 如 5.9724e24
    static RADIUS        = <半径，单位 m>;         // 如 6.3710e6
    static ORBIT_RADIUS  = <轨道半径，单位 m>;      // 恒星=0，行星=实际值
    static VISUAL_RADIUS = <视觉大小，场景单位>;     // 如 0.48
    static COLOR         = <颜色十六进制>;          // 如 0x4488ff
    static TEXTURE       = <贴图路径或 null>;       // 如 'Galaxy/xxx/planets/2k/tex.jpg' 或 null

    static DETAILS = `<详细描述文字>
支持多行文本。
• 要点可用符号标记
• 使用模板字符串`;

    static VOICE_INTRO = `<语音播报简介，一句话>`;

    constructor(scene) {
        super({
            key: <ClassName>.KEY,
            name: <ClassName>.NAME,
            nameCN: <ClassName>.NAME_CN,
            mass: <ClassName>.MASS,
            radius: <ClassName>.RADIUS,
            orbitRadius: <ClassName>.ORBIT_RADIUS,
            visualRadius: <ClassName>.VISUAL_RADIUS,
            color: <ClassName>.COLOR,
            texturePath: <ClassName>.TEXTURE,
            details: <ClassName>.DETAILS,
            voiceIntro: <ClassName>.VOICE_INTRO,
            rotationSpeed: <恒星0.15，行星1.0>,
            scene,
        });
        // 位置相对于系统原点（偏移量由 index.js 中的 SYSTEM_POS 统一处理）
        this.position.set(<ClassName>.ORBIT_RADIUS, 0, 0);
    }
}
```

### 字段规则

| 字段 | 规则 |
|---|---|
| `KEY` | 全局唯一，字母数字。恒星一般用系统名（如 `hd219134`），行星加后缀（如 `hd219134b`） |
| `MASS` | 单位 kg，科学计数法如 `1.989e30` |
| `RADIUS` | 单位 m，注意不是 km |
| `ORBIT_RADIUS` | 恒星填 `0`，行星用 `<数值> * 1.495978707e11`（即 AU 转米） |
| `VISUAL_RADIUS` | 视觉大小，恒星 3~5，行星 0.3~1.5 |
| `COLOR` | `0x` 开头十六进制 |
| `TEXTURE` | 字符串路径（相对于 index.html）或 `null` |
| `rotationSpeed` | 恒星 `0.15`，行星 `1.0` |
| `position.set` | 总填 `(<ClassName>.ORBIT_RADIUS, 0, 0)` — 系统整体偏移由 index.js 处理 |

---

## 2. `index.js` 模块入口模板

```js
// ============================================================
// Galaxy/<system-id>/index.js — <系统名> 模块入口
// 标准化格式：SYSTEM_INFO, PLANET_CLASSES, PLANET_DATA, SYSTEM_POS, createPlanets
// ============================================================

import { <StarClass> }  from './<StarClass>.js';
import { <PlanetB> }    from './<PlanetB>.js';
import { <PlanetC> }    from './<PlanetC>.js';
// ... 导入所有星体类

const AU = 1.495978707e11;

// ==================== 系统元信息 ====================

export const SYSTEM_INFO = {
    id: '<system-id>',
    name: '<系统中文名>',
    nameCN: '<System English Name>',
    description: '<系统描述>',
    icon: '<图标>',        // 如 '☀️', '🟠', '🔴'
};

// ==================== 星球类引用 ====================

export const PLANET_CLASSES = [
    <StarClass>,
    <PlanetB>,
    <PlanetC>,
    // ...
];

/** 系统在宇宙空间中的位置 (SI 单位: 米) */
export const SYSTEM_POS = { x: <X> * AU, y: <Y> * AU, z: <Z> * AU };
// 太阳系: { x: 0, y: 0, z: 0 }
// 系外系统: 离原点的偏移量

// ==================== 数据转换 ====================

function _classToInfo(cls) {
    return {
        KEY:           cls.KEY,
        NAME:          cls.NAME,
        NAME_CN:       cls.NAME_CN,
        MASS:          cls.MASS,
        RADIUS:        cls.RADIUS,
        ORBIT_RADIUS:  cls.ORBIT_RADIUS,
        VISUAL_RADIUS: cls.VISUAL_RADIUS,
        COLOR:         cls.COLOR,
        TEX_PATH:      cls.TEXTURE || null,
        DETAILS:       cls.DETAILS || '',
        VOICE_INTRO:   cls.VOICE_INTRO || '',
        IS_STAR:       cls.KEY === '<star_key>',
    };
}

/** 用于 galaxyRegistry 的纯数据数组 */
export const PLANET_DATA = PLANET_CLASSES.map(_classToInfo);

// ==================== 工厂函数 ====================

export function createPlanets(scene, existingPlanets = {}) {
    const bodies = {};

    for (const Cls of PLANET_CLASSES) {
        const key = Cls.KEY;
        if (existingPlanets[key]) continue;

        // 先相对于原点创建（位置在构造函数中设置）
        const body = new Cls(scene);

        // 偏移到系统在宇宙中的位置
        body.position.x += SYSTEM_POS.x;
        body.position.y += SYSTEM_POS.y;
        body.position.z += SYSTEM_POS.z;
        body._syncMeshPosition();

        bodies[key] = body;
    }

    // 设置圆形轨道速度（所有行星绕恒星运动）
    const star = bodies['<star_key>'];
    if (star) {
        for (const key of Object.keys(bodies)) {
            if (key === '<star_key>') continue;
            bodies[key].setCircularOrbitVelocity(star.mass);
        }
    }

    return bodies;
}
```

---

## 3. 已有系统参考

### 太阳系 — `Galaxy/solar system/`

| 文件 | 对应天体 |
|---|---|
| `Sun.js` | 太阳（G2V 黄矮星） |
| `Mercury.js` | 水星 |
| `Venus.js` | 金星 |
| `Earth.js` | 地球（有云层） |
| `Mars.js` | 火星 |
| `Jupiter.js` | 木星 |
| `Saturn.js` | 土星（有光环） |
| `Uranus.js` | 天王星 |
| `Neptune.js` | 海王星 |
| `index.js` | 模块入口 |

位置：`SYSTEM_POS = { x: 0, y: 0, z: 0 }`（宇宙原点）

### HD 219134 — `Galaxy/hd-219134/`

| 文件 | 对应天体 |
|---|---|
| `HD219134Star.js` | HD 219134（K3V 橙矮星） |
| `HD219134b.js` | 凌星超级地球 |
| `HD219134c.js` | 热海王星 |
| `HD219134f.js` | 宜居带超级地球 |
| `HD219134d.js` | 冰巨星 |
| `HD219134g.js` | 外围超级地球 |
| `HD219134h.js` | 冷气态巨行星 |
| `index.js` | 模块入口 |

位置：`SYSTEM_POS = { x: 30 * AU, y: 2 * AU, z: -10 * AU }`

---

## 4. 卫星文件模板

卫星（Moon）使用 `MoonBody` 基类，不加入 N 体物理引擎，使用简单圆周轨道绕母行星运行。

```js
// Galaxy/<system-id>/<planet>_<moon>.js — 卫星文件
// 文件名命名规范：母行星key_卫星key（全小写）
import { MoonBody } from '../../js/MoonBody.js';

export class <ClassName> extends MoonBody {
    // ---- 必填静态属性 ----
    static KEY          = '<唯一标识>';           // 如 'moon', 'phobos'
    static NAME         = '<中文名>';              // 如 '月球', '火卫一'
    static NAME_CN      = '<英文名>';
    static MASS         = <质量 kg>;
    static RADIUS       = <半径 m>;
    static PARENT_KEY   = '<母行星 key>';          // 如 'earth', 'mars'
    static ORBIT_RADIUS = <场景单位>;              // 距母行星的视觉距离
    static ORBIT_SPEED  = <弧度/秒>;               // 轨道角速度
    static VISUAL_RADIUS = <视觉大小 场景单位>;
    static COLOR        = <0x颜色>;
    static TEXTURE      = <贴图路径或 null>;

    // ---- 可选 ----
    static DETAILS     = `<详细描述>`;
    static VOICE_INTRO = `<语音简介>`;
}
```

### 卫星属性对照

| 属性 | 说明 | 示例 |
|---|---|---|
| `PARENT_KEY` | 母行星的 `KEY` | `'earth'`, `'mars'`, `'jupiter'` |
| `ORBIT_RADIUS` | 场景单位，非物理距离 | `1.2`（月球） |
| `ORBIT_SPEED` | 轨道角速度 rad/s | `0.8`（月球） |

### 当前已注册的卫星

定义在 `Galaxy/solar system/`：

| 文件名 | 类名 | 母行星 | 对应天体 |
|---|---|---|---|
| `earth_moon.js` | `Earth_Moon` | earth | 月球 |
| `mars_phobos.js` | `Mars_Phobos` | mars | 火卫一 |
| `mars_deimos.js` | `Mars_Deimos` | mars | 火卫二 |
| `jupiter_io.js` | `Jupiter_Io` | jupiter | 木卫一 |
| `jupiter_europa.js` | `Jupiter_Europa` | jupiter | 木卫二 |
| `jupiter_ganymede.js` | `Jupiter_Ganymede` | jupiter | 木卫三 |
| `jupiter_callisto.js` | `Jupiter_Callisto` | jupiter | 木卫四 |
| `saturn_titan.js` | `Saturn_Titan` | saturn | 土卫六 |
| `saturn_enceladus.js` | `Saturn_Enceladus` | saturn | 土卫二 |
| `saturn_rhea.js` | `Saturn_Rhea` | saturn | 土卫五 |
| `saturn_iapetus.js` | `Saturn_Iapetus` | saturn | 土卫八 |
| `uranus_titania.js` | `Uranus_Titania` | uranus | 天卫三 |
| `uranus_oberon.js` | `Uranus_Oberon` | uranus | 天卫四 |
| `neptune_triton.js` | `Neptune_Triton` | neptune | 海卫一 |

### 在 `index.js` 中注册卫星

```js
// 在模块入口中导入卫星类并导出 MOON_CLASSES
import { Earth_Moon } from './earth_moon.js';
// ... 其他卫星

export const MOON_CLASSES = {
    earth:   [Earth_Moon],
    mars:    [Mars_Phobos, Mars_Deimos],
    jupiter: [Jupiter_Io, Jupiter_Europa, Jupiter_Ganymede, Jupiter_Callisto],
    // ...
};
```

卫星的轨道更新由 `js/moons.js` 中的 `updateMoons()` 统一处理，每帧调用：

```js
import { updateMoons } from './moons.js';

// 在动画循环中：
for (const [key, planet] of Object.entries(planets)) {
    if (allMoons[key] && planet.mesh?.visible) {
        updateMoons(allMoons[key], planet.mesh.position, dt);
    }
}
```

---

## 6. 核心约束

1. **星体文件必须用 `class extends CelestialBody`**，卫星文件用 `class extends MoonBody`
2. **每个文件一个类**，不要在一个文件里写多个星体或卫星
3. **`index.js` 必须导出全部符号**：
   - `SYSTEM_INFO` — 系统元信息
   - `PLANET_CLASSES` — 星体类引用数组
   - `PLANET_DATA` — 纯数据数组（通过 `_classToInfo` 自动生成）
   - `SYSTEM_POS` — 系统在宇宙中的位置（SI 单位）
   - `createPlanets(scene, existingPlanets?)` — 工厂函数
4. **`ORBIT_RADIUS` 使用 SI 单位（米）**，用 `1.495978707e11` 表示 1 AU
5. 每个行星的位置统一在构造器中设为 `(<ORBIT_RADIUS>, 0, 0)`，系统整体偏移由 `createPlanets` 中的 `SYSTEM_POS` 统一处理 — **星体文件不需要知道系统在宇宙中的位置**
6. 常量 `AU` 定义在 `index.js` 内，星体文件中直接使用数值表达式

---

## 7. API 快速创建（服务器端）

```
POST http://127.0.0.1:8765/create-galaxy
Content-Type: application/json
```

请求体格式参见 `POST /create-galaxy` 端点文档。服务器自动生成完整的文件夹结构、独立星体文件和标准化 `index.js`。
