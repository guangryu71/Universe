#!/usr/bin/env python3
"""

功能总结
voice.py 是一个完整的 AI 机械电子音 TTS 合成器，处理流程：


文字 → pyttsx3 TTS → 音调偏移 → 带通滤波 → 环形调制 → 位深压缩 → 采样率降低 → 失真 → 颤音 → 梳状滤波 → WAV 输出
可调节参数（RoboticVoiceConfig）
参数	默认值	说明
ring_mod_freq	55 Hz	环形调制载波频率 — 越高越"尖"
ring_mod_mix	0.45	环形调制干湿比 0~1
bit_depth	8	位深 2~16，越低越破碎
sample_rate_reduction	11025 Hz	低采样率模拟
bandpass_low/high	300~3400 Hz	带通范围（电话/机械感）
filter_order	4	滤波器阶数
distortion_gain	2.5	失真量
vibrato_rate/depth	5.5 Hz / 0.003s	颤音
echo_delay/decay	0.035s / 0.35	梳状滤波（金属共鸣）
pitch_semitones	-2	音高偏移（半音）
volume	0.85	音量
speed_factor	1.0	语速倍率

7 个预设
ai_assistant — AI 助手音 (默认)
classic_robot — 经典机器人
dalek — Dalek 风格（激进）
glitch_ai — 故障 AI
subtle_cyborg — 轻度赛博格
old_radio — 老式收音机
deep_mech — 低沉机械

使用方式

# CLI
python voice.py "你好世界"
python voice.py -p dalek "EXTERMINATE!"
python voice.py -p glitch_ai -o output.wav "系统故障"
# CLI: 合成并播放（不保存）
python voice.py --play "你好世界"
# CLI: 播放并保存
python voice.py --play-save -p dalek "你好"
# 默认：仅保存文件（和之前一样）
python voice.py "你好世界"

# Python API
from voice import synthesize
synthesize("你好", preset="dalek")
synthesize("你好", preset="custom", ring_mod_freq=80, bit_depth=6)

# 或使用类方法
from voice import speak
speak("你好世界")                          # 播放，不保存
speak("你好世界", preset="dalek")          # Dalek 风格
speak("你好世界", save=True)              # 播放并保存

# 或使用类方法
from voice import RoboticVoiceSynthesizer
synth = RoboticVoiceSynthesizer()
synth.speak("你好世界", preset="glitch_ai", save=True)

# 播放已有文件
RoboticVoiceSynthesizer.play_file("robotic_voice_output.wav")

播放后端（自动选择）
sounddevice（推荐，pip install sounddevice）— 直接播放 numpy 音频
pygame — 备选方案
winsound（Windows 内置）— 零依赖
系统默认播放器 — 最后兜底

"""

import sys
import os
import tempfile
from pathlib import Path
from typing import Optional

# Fix Windows GBK console encoding for emoji/Unicode output
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

import numpy as np

# ============================================================
# Audio Effect Processors (纯 numpy 实现，无需额外依赖)
# ============================================================

class AudioEffects:
    """Collection of audio effects for robotic voice processing."""

    @staticmethod
    def ring_modulation(audio: np.ndarray, sr: int, freq: float, mix: float = 0.5) -> np.ndarray:
        """
        环形调制 — 制造"电子/AI"质感。
        将信号乘以一个正弦载波，产生金属感的边带频率。
        """
        t = np.arange(len(audio)) / sr
        carrier = np.sin(2 * np.pi * freq * t)
        modulated = audio * carrier
        peak = np.max(np.abs(modulated)) + 1e-10
        modulated = modulated / peak * np.max(np.abs(audio))
        return (1 - mix) * audio + mix * modulated

    @staticmethod
    def bit_crush(audio: np.ndarray, bit_depth: int) -> np.ndarray:
        """
        位深压缩 — 降低量化精度，产生"数字/旧电脑"感。
        bit_depth: 2-16，越低越破碎
        """
        max_val = float(2 ** (bit_depth - 1) - 1)
        crushed = np.round(audio * max_val) / max_val
        return crushed

    @staticmethod
    def sample_rate_reduce(audio: np.ndarray, orig_sr: int, target_sr: int) -> np.ndarray:
        """
        采样率降低 — 零阶保持，模拟低采样率设备。
        """
        if target_sr >= orig_sr:
            return audio
        ratio = orig_sr // target_sr
        if ratio < 2:
            return audio
        downsampled = audio[::ratio]
        upsampled = np.repeat(downsampled, ratio)
        if len(upsampled) > len(audio):
            upsampled = upsampled[:len(audio)]
        elif len(upsampled) < len(audio):
            upsampled = np.pad(upsampled, (0, len(audio) - len(upsampled)), mode='edge')
        return upsampled

    @staticmethod
    def _simple_bandpass(audio: np.ndarray, sr: int, low: float, high: float) -> np.ndarray:
        """
        简易带通滤波 — 纯 numpy 实现，无需 scipy。
        用移动平均实现低通，再通过差分实现带通。
        """
        nyq = sr / 2
        low = max(20, min(low, nyq - 1))
        high = max(low + 20, min(high, nyq - 1))

        # 高通：原信号 - 低通(low)
        n_l = max(1, int(sr / (low * 2)))
        kernel_l = np.ones(n_l) / n_l
        lp = np.convolve(audio, kernel_l, mode='same')
        hp = audio - lp

        # 再低通(high) → 带通
        n_h = max(1, int(sr / (high * 2)))
        kernel_h = np.ones(n_h) / n_h
        bp = np.convolve(hp, kernel_h, mode='same')

        peak = np.max(np.abs(bp)) + 1e-10
        return bp / peak * np.max(np.abs(audio))

    @staticmethod
    def bandpass_filter(audio: np.ndarray, sr: int, low: float, high: float, order: int = 4) -> np.ndarray:
        """
        带通滤波 — 优先使用 scipy butterworth，否则回退到简易实现。
        """
        try:
            from scipy import signal as sig
            nyquist = sr / 2
            low_norm = max(0.001, min(0.999, low / nyquist))
            high_norm = max(0.001, min(0.999, high / nyquist))
            if low_norm >= high_norm:
                return audio
            b, a = sig.butter(order, [low_norm, high_norm], btype='band')
            return sig.lfilter(b, a, audio)
        except ImportError:
            return AudioEffects._simple_bandpass(audio, sr, low, high)

    @staticmethod
    def distortion(audio: np.ndarray, gain: float) -> np.ndarray:
        """
        软削波失真 — 添加颗粒感和侵略性。
        """
        driven = audio * gain
        distorted = np.tanh(driven)
        return distorted * (np.max(np.abs(audio)) / (np.max(np.abs(distorted)) + 1e-10))

    @staticmethod
    def vibrato(audio: np.ndarray, sr: int, rate: float, depth: float) -> np.ndarray:
        """
        颤音效果 — 通过可变延迟调制产生频率摆动。
        """
        t = np.arange(len(audio)) / sr
        delay_samples = depth * sr * np.sin(2 * np.pi * rate * t)
        indices = np.arange(len(audio), dtype=np.float64) - delay_samples
        idx_floor = np.clip(np.floor(indices).astype(int), 0, len(audio) - 1)
        idx_ceil = np.clip(np.ceil(indices).astype(int), 0, len(audio) - 1)
        frac = indices - idx_floor
        return (1 - frac) * audio[idx_floor] + frac * audio[idx_ceil]

    @staticmethod
    def comb_filter(audio: np.ndarray, sr: int, delay: float, decay: float) -> np.ndarray:
        """
        梳状滤波 — 反馈延迟产生金属共鸣腔效果。
        """
        delay_samples = max(1, int(delay * sr))
        output = np.array(audio, dtype=np.float64, copy=True)
        for i in range(delay_samples, len(audio)):
            output[i] += decay * output[i - delay_samples]
        peak = np.max(np.abs(output)) + 1e-10
        return output / peak * np.max(np.abs(audio))

    @staticmethod
    def pitch_shift(audio: np.ndarray, semitones: float) -> np.ndarray:
        """
        音调偏移 — 通过重采样改变音高（同时改变速度）。
        """
        if abs(semitones) < 0.01:
            return audio
        factor = 2.0 ** (semitones / 12.0)
        old_len = len(audio)
        new_len = int(old_len / factor)
        new_indices = np.linspace(0, old_len - 1, new_len)
        idx_f = np.clip(np.floor(new_indices).astype(int), 0, old_len - 1)
        idx_c = np.clip(np.ceil(new_indices).astype(int), 0, old_len - 1)
        frac = new_indices - idx_f
        return (1 - frac) * audio[idx_f] + frac * audio[idx_c]


# ============================================================
# 配置
# ============================================================

class RoboticVoiceConfig:
    """机械电子音合成参数配置"""

    def __init__(
        self,
        # ── 环形调制（电子/AI 质感） ──
        ring_mod_freq: float = 55.0,       # 载波频率 (Hz)，越高越"尖"
        ring_mod_mix: float = 0.45,        # 干湿比 0~1，0=原声 1=全调制

        # ── 数字退化（旧电脑/数字感） ──
        bit_depth: int = 8,                # 位深 2~16，越低越破碎
        sample_rate_reduction: int = 11025, # 目标低采样率 (Hz)

        # ── 带通滤波（机械/电话/无线电感） ──
        bandpass_low: float = 300.0,       # 低截止 (Hz)
        bandpass_high: float = 3400.0,     # 高截止 (Hz)
        filter_order: int = 4,             # 滤波器阶数

        # ── 失真（颗粒感） ──
        distortion_gain: float = 2.5,      # >1 越大越失真，1=不变

        # ── 颤音（不稳定机械调制） ──
        vibrato_rate: float = 5.5,         # 频率 (Hz)
        vibrato_depth: float = 0.003,      # 深度（秒）

        # ── 梳状滤波（金属共鸣腔） ──
        echo_delay: float = 0.035,         # 延迟 (秒)
        echo_decay: float = 0.35,          # 衰减系数 0~1

        # ── 音高 ──
        pitch_semitones: float = -2.0,     # 半音，负=低沉，正=尖锐

        # ── 输出 ──
        output_sample_rate: int = 44100,   # 输出采样率
        volume: float = 0.85,              # 音量 0~1
        speed_factor: float = 1.0,         # 语速倍率
    ):
        self.ring_mod_freq = float(ring_mod_freq)
        self.ring_mod_mix = float(np.clip(ring_mod_mix, 0, 1))
        self.bit_depth = int(max(1, min(16, bit_depth)))
        self.sample_rate_reduction = int(sample_rate_reduction)
        self.bandpass_low = float(bandpass_low)
        self.bandpass_high = float(bandpass_high)
        self.filter_order = int(filter_order)
        self.distortion_gain = float(distortion_gain)
        self.vibrato_rate = float(vibrato_rate)
        self.vibrato_depth = float(vibrato_depth)
        self.echo_delay = float(echo_delay)
        self.echo_decay = float(np.clip(echo_decay, 0, 1))
        self.pitch_semitones = float(pitch_semitones)
        self.output_sample_rate = int(output_sample_rate)
        self.volume = float(np.clip(volume, 0, 1))
        self.speed_factor = float(max(0.25, min(4.0, speed_factor)))


# ── 预设 ──

PRESETS: dict[str, RoboticVoiceConfig] = {
    "classic_robot": RoboticVoiceConfig(
        ring_mod_freq=50.0, ring_mod_mix=0.5,
        bit_depth=8, sample_rate_reduction=11025,
        bandpass_low=300, bandpass_high=3000,
        distortion_gain=2.5,
        vibrato_rate=5.0, vibrato_depth=0.004,
        echo_delay=0.04, echo_decay=0.4,
        pitch_semitones=-3.0,
    ),
    "ai_assistant": RoboticVoiceConfig(
        ring_mod_freq=70.0, ring_mod_mix=0.3,
        bit_depth=10, sample_rate_reduction=16000,
        bandpass_low=200, bandpass_high=4000,
        distortion_gain=1.5,
        vibrato_rate=4.0, vibrato_depth=0.002,
        echo_delay=0.02, echo_decay=0.25,
        pitch_semitones=0.0,
    ),
    "dalek": RoboticVoiceConfig(
        ring_mod_freq=120.0, ring_mod_mix=0.7,
        bit_depth=4, sample_rate_reduction=8000,
        bandpass_low=500, bandpass_high=2500,
        distortion_gain=4.0,
        vibrato_rate=8.0, vibrato_depth=0.006,
        echo_delay=0.05, echo_decay=0.5,
        pitch_semitones=2.0,
    ),
    "glitch_ai": RoboticVoiceConfig(
        ring_mod_freq=90.0, ring_mod_mix=0.6,
        bit_depth=6, sample_rate_reduction=8000,
        bandpass_low=400, bandpass_high=3500,
        distortion_gain=3.0,
        vibrato_rate=6.0, vibrato_depth=0.005,
        echo_delay=0.03, echo_decay=0.3,
        pitch_semitones=-1.0,
    ),
    "subtle_cyborg": RoboticVoiceConfig(
        ring_mod_freq=35.0, ring_mod_mix=0.2,
        bit_depth=12, sample_rate_reduction=22050,
        bandpass_low=150, bandpass_high=6000,
        distortion_gain=1.3,
        vibrato_rate=3.0, vibrato_depth=0.001,
        echo_delay=0.015, echo_decay=0.15,
        pitch_semitones=0.0,
    ),
    "old_radio": RoboticVoiceConfig(
        ring_mod_freq=0, ring_mod_mix=0,
        bit_depth=8, sample_rate_reduction=11025,
        bandpass_low=500, bandpass_high=2500,
        distortion_gain=2.0,
        vibrato_rate=2.0, vibrato_depth=0.002,
        echo_delay=0.06, echo_decay=0.5,
        pitch_semitones=0.0,
    ),
    "deep_mech": RoboticVoiceConfig(
        ring_mod_freq=40.0, ring_mod_mix=0.55,
        bit_depth=7, sample_rate_reduction=10000,
        bandpass_low=200, bandpass_high=2500,
        distortion_gain=3.5,
        vibrato_rate=3.5, vibrato_depth=0.005,
        echo_delay=0.05, echo_decay=0.45,
        pitch_semitones=-5.0,
    ),
}


# ============================================================
# 主合成器
# ============================================================

class RoboticVoiceSynthesizer:
    """
    AI 机械电子音合成器。

    流程:
        1. 文字 → TTS 基础语音 (pyttsx3)
        2. 音调偏移
        3. 带通滤波 → 机械/电话质感
        4. 环形调制 → 电子/AI 质感
        5. 位深压缩 → 数字破碎感
        6. 采样率降低 → 旧设备感
        7. 失真 → 颗粒感
        8. 颤音 → 不稳定调制
        9. 梳状滤波 → 金属共鸣
        10. 音量归一化 → 输出 WAV
    """

    def __init__(self, config: Optional[RoboticVoiceConfig] = None):
        self.config = config or RoboticVoiceConfig()
        self._engine = None

    # ── TTS 引擎 ──

    def _get_engine(self):
        if self._engine is None:
            import pyttsx3
            self._engine = pyttsx3.init()
            rate = self._engine.getProperty('rate')
            self._engine.setProperty('rate', int(rate * self.config.speed_factor))
        return self._engine

    def _tts_to_array(self, text: str) -> tuple[np.ndarray, int]:
        """用 pyttsx3 将文字转为基础语音，返回 (音频数组, 采样率)。"""
        engine = self._get_engine()

        # 写入临时 WAV
        tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
        tmp_path = tmp.name
        tmp.close()

        try:
            engine.save_to_file(text, tmp_path)
            engine.runAndWait()

            # 读回
            try:
                from scipy.io import wavfile
                sr, audio = wavfile.read(tmp_path)
            except ImportError:
                import wave
                with wave.open(tmp_path, 'rb') as wf:
                    sr = wf.getframerate()
                    n_frames = wf.getnframes()
                    data = wf.readframes(n_frames)
                    audio = np.frombuffer(data, dtype=np.int16)

            if audio.dtype == np.int16:
                audio = audio.astype(np.float64) / 32768.0
            elif audio.dtype == np.int32:
                audio = audio.astype(np.float64) / 2147483648.0
            else:
                audio = audio.astype(np.float64)

            if audio.ndim > 1:
                audio = audio.mean(axis=1)

            return audio, sr
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _synth_fallback(self, text: str) -> tuple[np.ndarray, int]:
        """
        纯合成应急方案 — 无 TTS 引擎时用脉冲串 + 共振峰生成基础机器人声。
        """
        sr = 22050
        dur_per_char = 0.07
        total_dur = len(text) * dur_per_char + 0.4
        t = np.arange(int(total_dur * sr)) / sr

        f0 = 120.0
        pulse = np.zeros(len(t))
        step = max(1, int(sr / f0))
        pulse[::step] = 1.0

        # 简单包络
        env = 0.5 + 0.5 * np.sin(2 * np.pi * 2.5 * t) * np.sin(2 * np.pi * 1.2 * t)

        # 粗共振峰
        try:
            from scipy import signal as sig
            nyq = sr / 2
            b1, a1 = sig.butter(2, [350/nyq, 900/nyq], btype='band')
            b2, a2 = sig.butter(2, [1000/nyq, 2200/nyq], btype='band')
            b3, a3 = sig.butter(2, [2200/nyq, 3500/nyq], btype='band')
            f1 = sig.lfilter(b1, a1, pulse)
            f2 = sig.lfilter(b2, a2, pulse)
            f3 = sig.lfilter(b3, a3, pulse)
            audio = (f1 * 0.5 + f2 * 0.35 + f3 * 0.15) * env
        except ImportError:
            audio = pulse * env

        audio /= np.max(np.abs(audio)) + 1e-10
        return audio.astype(np.float64), sr

    # ── 主流程 ──

    def synthesize(
        self,
        text: str,
        output_path: Optional[str] = None,
        config: Optional[RoboticVoiceConfig] = None,
        preset: Optional[str] = None,
        verbose: bool = True,
    ) -> str:
        """
        合成机械电子音。

        参数:
            text:        要合成的文字
            output_path: 输出路径（None = 脚本所在目录/robotic_voice_output.wav）
            config:      自定义配置（覆盖默认/预设）
            preset:      预设名称: classic_robot, ai_assistant, dalek,
                         glitch_ai, subtle_cyborg, old_radio, deep_mech
            verbose:     打印处理信息

        返回:
            输出文件路径
        """
        # ── 确定配置 ──
        if preset and preset in PRESETS:
            cfg = PRESETS[preset]
        elif config:
            cfg = config
        else:
            cfg = self.config

        if verbose:
            label = f" [{preset}]" if preset else ""
            print(f"[RoboticVoice] 机械电子音合成器{label}")
            print(f"   文本: \"{text[:60]}{'...' if len(text) > 60 else ''}\"")
            print(f"   参数: ring={cfg.ring_mod_freq}Hz mix={cfg.ring_mod_mix} "
                  f"bits={cfg.bit_depth} bp={cfg.bandpass_low}-{cfg.bandpass_high}Hz "
                  f"pitch={cfg.pitch_semitones:+.0f}st")

        # ── 1. 获取基础语音 ──
        try:
            audio, sr = self._tts_to_array(text)
            if verbose:
                print(f"   TTS 引擎: pyttsx3, {len(audio)/sr:.1f}s @ {sr}Hz")
        except Exception as e:
            if verbose:
                print(f"   [!] pyttsx3 不可用 ({e})")
                print(f"   使用纯合成应急方案...")
            audio, sr = self._synth_fallback(text)

        # ── 2. 重采样到目标采样率 ──
        if sr != cfg.output_sample_rate:
            ratio = cfg.output_sample_rate / sr
            new_len = int(len(audio) * ratio)
            audio = np.interp(
                np.linspace(0, len(audio) - 1, new_len),
                np.arange(len(audio)),
                audio,
            )
            sr = cfg.output_sample_rate

        fx = AudioEffects()

        # ── 3. 音调偏移 ──
        if abs(cfg.pitch_semitones) > 0.01:
            audio = fx.pitch_shift(audio, cfg.pitch_semitones)
            if verbose:
                print(f"   [OK]音调偏移: {cfg.pitch_semitones:+.0f} 半音")

        # ── 4. 带通滤波 ──
        if cfg.bandpass_low > 0 or cfg.bandpass_high < sr / 2:
            audio = fx.bandpass_filter(audio, sr, cfg.bandpass_low, cfg.bandpass_high, cfg.filter_order)
            if verbose:
                print(f"   [OK]带通滤波: {cfg.bandpass_low:.0f}-{cfg.bandpass_high:.0f} Hz (order={cfg.filter_order})")

        # ── 5. 环形调制 ──
        if cfg.ring_mod_mix > 0.001 and cfg.ring_mod_freq > 0:
            audio = fx.ring_modulation(audio, sr, cfg.ring_mod_freq, cfg.ring_mod_mix)
            if verbose:
                print(f"   [OK]环形调制: {cfg.ring_mod_freq}Hz (mix={cfg.ring_mod_mix:.2f})")

        # ── 6. 位深压缩 ──
        if cfg.bit_depth < 16:
            audio = fx.bit_crush(audio, cfg.bit_depth)
            if verbose:
                print(f"   [OK]位深压缩: {cfg.bit_depth}-bit")

        # ── 7. 采样率降低 ──
        if cfg.sample_rate_reduction < sr:
            audio = fx.sample_rate_reduce(audio, sr, cfg.sample_rate_reduction)
            if verbose:
                print(f"   [OK]采样率降低: {cfg.sample_rate_reduction} Hz")

        # ── 8. 失真 ──
        if cfg.distortion_gain > 1.01:
            audio = fx.distortion(audio, cfg.distortion_gain)
            if verbose:
                print(f"   [OK]失真: gain={cfg.distortion_gain:.1f}")

        # ── 9. 颤音 ──
        if cfg.vibrato_depth > 0.0001:
            audio = fx.vibrato(audio, sr, cfg.vibrato_rate, cfg.vibrato_depth)
            if verbose:
                print(f"   [OK]颤音: {cfg.vibrato_rate}Hz depth={cfg.vibrato_depth:.4f}s")

        # ── 10. 梳状滤波 ──
        if cfg.echo_decay > 0.001:
            audio = fx.comb_filter(audio, sr, cfg.echo_delay, cfg.echo_decay)
            if verbose:
                print(f"   [OK]梳状滤波: delay={cfg.echo_delay:.3f}s decay={cfg.echo_decay:.2f}")

        # ── 11. 音量 & 限幅 ──
        audio *= cfg.volume
        peak = np.max(np.abs(audio))
        if peak > 0.98:
            audio = audio / peak * 0.95

        # ── 12. 写出 ──
        if output_path is None:
            output_path = str(Path(__file__).parent / "robotic_voice_output.wav")
        output_path = str(Path(output_path))

        # 转为 int16 写出
        audio_int16 = (audio * 32767).clip(-32768, 32767).astype(np.int16)

        try:
            from scipy.io import wavfile
            wavfile.write(output_path, sr, audio_int16)
        except ImportError:
            import wave
            with wave.open(output_path, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                wf.writeframes(audio_int16.tobytes())

        if verbose:
            print(f"   [SAVE] 输出: {output_path}")
            print(f"   [TIME] 时长: {len(audio)/sr:.2f}s | {sr}Hz | 16-bit mono")
            print(f"   [DONE] 完成!")

        return output_path

    # ── 内部: 效果链处理 ──

    def _apply_effects(self, audio: np.ndarray, sr: int, cfg: RoboticVoiceConfig, verbose: bool = False) -> np.ndarray:
        """对音频数组应用完整效果链，返回处理后的数组（synthesize 和 speak 共用）。"""
        fx = AudioEffects()

        if abs(cfg.pitch_semitones) > 0.01:
            audio = fx.pitch_shift(audio, cfg.pitch_semitones)
            if verbose:
                print(f"   [OK]音调偏移: {cfg.pitch_semitones:+.0f} 半音")

        if cfg.bandpass_low > 0 or cfg.bandpass_high < sr / 2:
            audio = fx.bandpass_filter(audio, sr, cfg.bandpass_low, cfg.bandpass_high, cfg.filter_order)
            if verbose:
                print(f"   [OK]带通滤波: {cfg.bandpass_low:.0f}-{cfg.bandpass_high:.0f} Hz (order={cfg.filter_order})")

        if cfg.ring_mod_mix > 0.001 and cfg.ring_mod_freq > 0:
            audio = fx.ring_modulation(audio, sr, cfg.ring_mod_freq, cfg.ring_mod_mix)
            if verbose:
                print(f"   [OK]环形调制: {cfg.ring_mod_freq}Hz (mix={cfg.ring_mod_mix:.2f})")

        if cfg.bit_depth < 16:
            audio = fx.bit_crush(audio, cfg.bit_depth)
            if verbose:
                print(f"   [OK]位深压缩: {cfg.bit_depth}-bit")

        if cfg.sample_rate_reduction < sr:
            audio = fx.sample_rate_reduce(audio, sr, cfg.sample_rate_reduction)
            if verbose:
                print(f"   [OK]采样率降低: {cfg.sample_rate_reduction} Hz")

        if cfg.distortion_gain > 1.01:
            audio = fx.distortion(audio, cfg.distortion_gain)
            if verbose:
                print(f"   [OK]失真: gain={cfg.distortion_gain:.1f}")

        if cfg.vibrato_depth > 0.0001:
            audio = fx.vibrato(audio, sr, cfg.vibrato_rate, cfg.vibrato_depth)
            if verbose:
                print(f"   [OK]颤音: {cfg.vibrato_rate}Hz depth={cfg.vibrato_depth:.4f}s")

        if cfg.echo_decay > 0.001:
            audio = fx.comb_filter(audio, sr, cfg.echo_delay, cfg.echo_decay)
            if verbose:
                print(f"   [OK]梳状滤波: delay={cfg.echo_delay:.3f}s decay={cfg.echo_decay:.2f}")

        audio *= cfg.volume
        peak = np.max(np.abs(audio))
        if peak > 0.98:
            audio = audio / peak * 0.95

        return audio

    # ── 播放 ──

    @staticmethod
    def _play_audio_array(audio: np.ndarray, sr: int) -> None:
        """
        直接播放 numpy 音频数组。
        按优先级尝试: sounddevice > pygame > winsound(Windows) > 系统命令
        """
        played = False

        # 后端 1: sounddevice (推荐)
        if not played:
            try:
                import sounddevice as sd
                sd.play(audio.astype(np.float32), samplerate=sr)
                sd.wait()
                played = True
            except ImportError:
                pass
            except Exception as e:
                print(f"   [!] sounddevice 播放失败: {e}")

        # 后端 2: pygame
        if not played:
            try:
                import pygame
                import io as _io

                # 将音频转为 WAV bytes
                audio_int16 = (audio * 32767).clip(-32768, 32767).astype(np.int16)
                buf = _io.BytesIO()
                import wave as _wave
                with _wave.open(buf, 'wb') as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sr)
                    wf.writeframes(audio_int16.tobytes())
                buf.seek(0)

                pygame.mixer.init(frequency=sr, size=-16, channels=1)
                sound = pygame.mixer.Sound(buf)
                sound.play()
                pygame.time.wait(int(len(audio) / sr * 1000) + 200)
                pygame.mixer.quit()
                played = True
            except ImportError:
                pass
            except Exception as e:
                print(f"   [!] pygame 播放失败: {e}")

        # 后端 3: winsound (Windows)
        if not played and sys.platform == 'win32':
            try:
                import winsound
                import tempfile as _tmp

                audio_int16 = (audio * 32767).clip(-32768, 32767).astype(np.int16)
                tmp = _tmp.NamedTemporaryFile(suffix='.wav', delete=False)
                tmp_path = tmp.name
                tmp.close()
                try:
                    import wave as _wave
                    with _wave.open(tmp_path, 'wb') as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(sr)
                        wf.writeframes(audio_int16.tobytes())
                    winsound.PlaySound(tmp_path, winsound.SND_FILENAME)
                    played = True
                finally:
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass
            except ImportError:
                pass
            except Exception as e:
                print(f"   [!] winsound 播放失败: {e}")

        # 后端 4: 系统命令
        if not played:
            RoboticVoiceSynthesizer._play_via_system_cmd(audio, sr)

        if not played:
            print("   [!] 所有播放后端均不可用。请安装 sounddevice: pip install sounddevice")

    @staticmethod
    def _play_via_system_cmd(audio: np.ndarray, sr: int) -> None:
        """通过系统命令播放（先写临时 WAV 再调用系统播放器）。"""
        import subprocess
        import tempfile as _tmp

        audio_int16 = (audio * 32767).clip(-32768, 32767).astype(np.int16)
        tmp = _tmp.NamedTemporaryFile(suffix='.wav', delete=False)
        tmp_path = tmp.name
        tmp.close()
        try:
            import wave as _wave
            with _wave.open(tmp_path, 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                wf.writeframes(audio_int16.tobytes())

            if sys.platform == 'win32':
                os.startfile(tmp_path)
            elif sys.platform == 'darwin':
                subprocess.run(['afplay', tmp_path], timeout=60)
            else:
                subprocess.run(['aplay', tmp_path], timeout=60)
            # 等播放完
            import time
            time.sleep(len(audio) / sr + 0.5)
        finally:
            # 延迟清理，给播放器时间打开文件
            import time
            time.sleep(0.3)
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    @staticmethod
    def play_file(filepath: str) -> None:
        """
        播放已有的 WAV 音频文件。

        示例:
            >>> RoboticVoiceSynthesizer.play_file("robotic_voice_output.wav")
        """
        try:
            from scipy.io import wavfile
            sr, audio = wavfile.read(filepath)
        except ImportError:
            import wave as _wave
            with _wave.open(filepath, 'rb') as wf:
                sr = wf.getframerate()
                n_frames = wf.getnframes()
                data = wf.readframes(n_frames)
                audio = np.frombuffer(data, dtype=np.int16)

        if audio.dtype == np.int16:
            audio = audio.astype(np.float64) / 32768.0
        elif audio.dtype == np.int32:
            audio = audio.astype(np.float64) / 2147483648.0
        else:
            audio = audio.astype(np.float64)

        if audio.ndim > 1:
            audio = audio.mean(axis=1)

        print(f"🔊 播放: {filepath} ({len(audio)/sr:.1f}s)")
        RoboticVoiceSynthesizer._play_audio_array(audio, sr)

    def speak(
        self,
        text: str,
        config: Optional[RoboticVoiceConfig] = None,
        preset: Optional[str] = None,
        save: bool = False,
        output_path: Optional[str] = None,
        verbose: bool = True,
    ) -> str:
        """
        合成并直接播放机械电子音（合成完立刻读出来）。

        参数:
            text:        要合成并播放的文字
            config:      自定义配置
            preset:      预设名称
            save:        是否同时保存文件
            output_path: 输出路径（save=True 时生效，None 则自动命名）
            verbose:     打印处理信息

        返回:
            若 save=True 返回文件路径，否则返回空字符串

        示例:
            >>> synth = RoboticVoiceSynthesizer()
            >>> synth.speak("你好世界")
            >>> synth.speak("你好世界", preset="dalek", save=True)
        """
        if output_path is None and save:
            output_path = str(Path(__file__).parent / "robotic_voice_output.wav")

        path = self.synthesize(
            text,
            output_path=output_path if save else None,
            config=config,
            preset=preset,
            verbose=verbose,
        )

        # 从已保存的文件读取播放（或直接重读已处理音频）
        if save and path:
            self.play_file(path)
        else:
            # 不保存时：直接走 TTS + 效果链 + 播放，不写磁盘
            if preset and preset in PRESETS:
                cfg = PRESETS[preset]
            elif config:
                cfg = config
            else:
                cfg = self.config

            try:
                audio, sr = self._tts_to_array(text)
            except Exception:
                audio, sr = self._synth_fallback(text)

            if sr != cfg.output_sample_rate:
                ratio = cfg.output_sample_rate / sr
                new_len = int(len(audio) * ratio)
                audio = np.interp(
                    np.linspace(0, len(audio) - 1, new_len),
                    np.arange(len(audio)),
                    audio,
                )
                sr = cfg.output_sample_rate

            audio = self._apply_effects(audio, sr, cfg, verbose=verbose)

            if verbose:
                print(f"   [PLAY] 正在播放...")

            self._play_audio_array(audio, sr)

        return path


# ============================================================
# 便捷函数
# ============================================================

def synthesize(
    text: str,
    output_path: Optional[str] = None,
    preset: str = "ai_assistant",
    **kwargs,
) -> str:
    """
    一行调用合成机械电子音。

    参数:
        text:        要合成的文字
        output_path: 输出路径 (默认根目录/robotic_voice_output.wav)
        preset:      预设名，或 "custom" + **kwargs 自定义
        **kwargs:    当 preset="custom" 时传入 RoboticVoiceConfig 参数

    返回:
        输出文件路径

    示例:
        >>> synthesize("你好世界")
        >>> synthesize("你好世界", preset="dalek")
        >>> synthesize("你好世界", preset="custom",
        ...            ring_mod_freq=80, bit_depth=6, pitch_semitones=-4)
    """
    if preset == "custom":
        cfg = RoboticVoiceConfig(**kwargs)
    else:
        cfg = None

    synth = RoboticVoiceSynthesizer()
    return synth.synthesize(text, output_path=output_path, config=cfg, preset=preset)


def speak(
    text: str,
    preset: str = "ai_assistant",
    save: bool = False,
    output_path: Optional[str] = None,
    **kwargs,
) -> str:
    """
    一行调用合成并直接播放机械电子音。

    参数:
        text:        要合成并播放的文字
        preset:      预设名，或 "custom" + **kwargs 自定义
        save:        是否同时保存 WAV 文件
        output_path: 输出路径（save=True 时生效）
        **kwargs:    当 preset="custom" 时传入 RoboticVoiceConfig 参数

    返回:
        若 save=True 返回文件路径，否则返回空字符串

    示例:
        >>> speak("你好世界")                          # 合成并播放
        >>> speak("你好世界", preset="dalek")           # Dalek 风格并播放
        >>> speak("你好世界", save=True)                # 播放同时保存
        >>> speak("你好世界", preset="custom",
        ...       ring_mod_freq=80, bit_depth=6)
    """
    if preset == "custom":
        cfg = RoboticVoiceConfig(**kwargs)
    else:
        cfg = None

    synth = RoboticVoiceSynthesizer()
    return synth.speak(text, config=cfg, preset=preset, save=save, output_path=output_path)


# ============================================================
# CLI / Demo
# ============================================================

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="AI 机械电子音合成器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
预设:
  classic_robot  - 经典机器人音
  ai_assistant   - AI 助手音 (默认)
  dalek          - Dalek 风格
  glitch_ai      - 故障 AI
  subtle_cyborg  - 轻度赛博格
  old_radio      - 老式收音机
  deep_mech      - 低沉机械

示例:
  python voice.py "你好，我是人工智能助手"
  python voice.py -p dalek "EXTERMINATE!"
  python voice.py -p glitch_ai -o output.wav "系统故障"
        """,
    )
    parser.add_argument("text", nargs="*", help="要合成的文字")
    parser.add_argument("-p", "--preset", default="ai_assistant",
                        choices=list(PRESETS.keys()),
                        help="音效预设 (默认: ai_assistant)")
    parser.add_argument("-o", "--output", default=None,
                        help="输出 WAV 文件路径")
    parser.add_argument("-l", "--list", action="store_true",
                        help="列出所有预设")
    parser.add_argument("--play", action="store_true",
                        help="合成后直接播放（不保存文件）")
    parser.add_argument("--play-save", action="store_true",
                        help="合成后播放并保存文件")

    args = parser.parse_args()

    if args.list:
        print("可用预设:")
        for name, cfg in PRESETS.items():
            print(f"  {name}:")
            print(f"    ring={cfg.ring_mod_freq}Hz mix={cfg.ring_mod_mix} "
                  f"bits={cfg.bit_depth} sr_down={cfg.sample_rate_reduction}")
            print(f"    bp={cfg.bandpass_low}-{cfg.bandpass_high}Hz "
                  f"dist={cfg.distortion_gain} pitch={cfg.pitch_semitones:+.0f}st")
            print(f"    vibrato={cfg.vibrato_rate}Hz echo={cfg.echo_delay}s/{cfg.echo_decay}")
        sys.exit(0)

    text = " ".join(args.text) if args.text else "你好，我是人工智能语音助手。这是机械电子合成音效测试。"
    output = args.output

    synth = RoboticVoiceSynthesizer()

    if args.play:
        # 仅播放，不保存
        synth.speak(text, preset=args.preset, save=False)
    elif args.play_save:
        # 播放并保存
        synth.speak(text, preset=args.preset, save=True, output_path=output)
    else:
        # 默认：仅保存文件
        synth.synthesize(text, output_path=output, preset=args.preset)
