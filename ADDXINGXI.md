# 添加新星系 — 完整指南

## 一、星系基本信息

| 属性 | 输入框 ID | 单位 | 示例值 | 说明 |
|---|---|---|---|---|
| 名称 | `ag-name` | — | 太阳系 | 中文星系名 |
| 英文名 | `ag-name-cn` | — | Solar System | 英文/拼音名 |
| 描述 | `ag-desc` | — | 以太阳为中心的恒星系统... | 简短介绍 |

## 二、中心恒星

| 属性 | 输入框 ID | 单位 | 示例(太阳) | 说明 |
|---|---|---|---|---|
| 名称 | `ag-star-name` | — | 太阳 | 恒星中文名 |
| 质量 | `ag-star-mass` | kg | 1.989×10³⁰ | 填写 `1.989e30`，太阳质量=1 M☉ |
| 半径 | `ag-star-radius` | km | 696340 | 太阳半径≈69.6万km；视觉大小由半径自动换算 |
| 颜色 | `ag-star-color` | hex | #ffcc00 | G型恒星黄白色 |
| 贴图 | `ag-star-texture` | 图片文件 | 2k_sun.jpg | 可选上传 |
| 位置 X | `ag-star-x` | AU | 50 | 相对原点的X坐标 |
| 位置 Y | `ag-star-y` | AU | 0 | Y坐标（黄道面=0） |
| 位置 Z | `ag-star-z` | AU | 0 | Z坐标 |

## 三、行星（可添加多个）

| 属性 | 输入框 class | 单位 | 示例(地球) | 说明 |
|---|---|---|---|---|
| 名称 | `.ag-p-name` | — | 地球 | 行星中文名 |
| 质量 | `.ag-p-mass` | kg | 5.97×10²⁴ | 填写 `5.97e24` |
| 半径 | `.ag-p-radius` | km | 6371 | 实际赤道半径；视觉大小由半径自动换算 |
| 轨道半径 | `.ag-p-orbit` | AU | 1.0 | 到恒星的平均距离 |
| 颜色 | `.ag-p-color` | hex | #4488ff | 程序化纹理回退色 |
| 贴图 | `.ag-p-texture` | 图片文件 | 8k_earth_daymap.jpg | 可选上传 |

## 四、参考数据速查

### 常见恒星质量

| 光谱类型 | 质量 (kg) | 半径 (km) | 颜色 |
|---|---|---|---|
| O/B 蓝巨星 | 1.989e31 (10 M☉) | 4,870,000 | #aaccff |
| A 白星 | 3.98e30 (2 M☉) | 1,250,000 | #ffffff |
| G 黄矮星(太阳) | 1.989e30 (1 M☉) | 696,340 | #ffcc00 |
| K 橙矮星 | 1.19e30 (0.6 M☉) | 520,000 | #ffaa44 |
| M 红矮星 | 4.97e29 (0.25 M☉) | 200,000 | #ff6644 |

### 常见行星类型

| 类型 | 质量 (kg) | 半径 (km) | 示例 |
|---|---|---|---|
| 岩石行星 | 3e23 ~ 6e24 | 2400 ~ 6400 | 水星/地球 |
| 超级地球 | 6e24 ~ 2e25 | 7000 ~ 15000 | — |
| 气态巨行星 | 1e26 ~ 2e27 | 25000 ~ 70000 | 木星/土星 |
| 冰巨行星 | 8e25 ~ 1e26 | 25000 | 天王星 |

> **1 AU = 1.496×10¹¹ 米**（日地平均距离）
>
> 💡 星系位置建议放在 **50 AU 以外**，避免与太阳系天体产生明显的引力干扰。

---

## 五、标准模块模板

项目支持两种方式添加新星系：

### 方式 A：服务器自动生成（推荐）

```
POST http://127.0.0.1:8765/create-galaxy
Content-Type: application/json
```

服务器自动创建完整文件夹结构和所有星体文件，详见 [Galaxy-模块标准模板.md](./Galaxy-模块标准模板.md)

### 方式 B：手动创建模块

按照 `Galaxy-模块标准模板.md` 中的规范，在 `Galaxy/` 下手动创建文件夹和文件：

```
Galaxy/<system-id>/
  index.js              # 模块入口（必须）
  <StarClass>.js        # 恒星文件
  <PlanetClass>b.js     # 行星文件
  <PlanetClass>c.js     # ...
  planets/2k/           # 贴图文件（可选）
```

每个星体文件遵循统一模板：

```js
import { CelestialBody } from '../../js/CelestialBody.js';

export class <ClassName> extends CelestialBody {
    static KEY           = '<唯一标识>';
    static NAME          = '<中文名>';
    static NAME_CN       = '<英文名>';
    static MASS          = <质量kg>;
    static RADIUS        = <半径m>;
    static ORBIT_RADIUS  = <轨道半径m>;
    static VISUAL_RADIUS = <视觉大小>;
    static COLOR         = <0x颜色>;
    static TEXTURE       = <贴图路径或null>;
    static DETAILS       = `<详细描述>`;
    static VOICE_INTRO   = `<语音简介>`;

    constructor(scene) {
        super({ key, name, nameCN, mass, radius, orbitRadius, visualRadius,
                color, texturePath, details, voiceIntro, rotationSpeed, scene });
        this.position.set(<ClassName>.ORBIT_RADIUS, 0, 0);
    }
}
```

> **注意**：手动添加后需要在 `js/galaxyRegistry.js` 中导入新模块并注册到 `SYSTEM_MODULES` 数组，或通过星语终端页面左上角的"添加单恒星系统"按钮操作。
