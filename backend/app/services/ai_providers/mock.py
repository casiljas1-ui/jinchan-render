"""Mock Provider —— 离线可用，跑通 Demo 全链路。

- generate_excuse：返回预置的中文理由模板（按联系人角色 + 场景挑选）。
- generate_voice：用正弦波合成一段“类语音”提示音 WAV（占位），
  证明「文件生成 → 存储 → 下载 → 播放」这条音频链路可用。
  真实语音请切换 ai_provider=minimax/openai 并填入对应 Key。
"""
import io
import math
import random
import struct
import wave

from ..ai_provider import AIProvider, VoiceResult

_SAMPLE_RATE = 16000

# 按「联系人角色」分组的理由模板，{} 会被场景/称呼替换
_EXCUSES: dict[str, list[str]] = {
    "老板": [
        "喂，你现在方便吗？公司这边有个紧急情况，客户临时改了需求，需要你尽快回个电话处理一下。",
        "不好意思打扰你，临时加开一个会议，你不在现场不行，能不能现在上线？",
    ],
    "同事": [
        "喂，你还在外面吗？王总刚刚过来找你，好像挺急的，让你赶紧回个电话。",
        "兄弟，项目线上出了点问题，只有你清楚那块逻辑，方便现在远程看一下吗？",
    ],
    "家人": [
        "喂，你现在方便说话吗？家里有点急事，你能先回来一趟吗？",
        "孩子突然有点不舒服，我得带他去医院，你那边能不能先结束回来？",
    ],
    "朋友": [
        "喂，你那边结束了吗？我们这边人都到齐了，就差你了，能不能现在过来？",
        "哥们，我车在半路抛锚了，能麻烦你过来接我一下吗？",
    ],
    "医生": [
        "您好，这里是社区诊所，您上次的体检结果出来了，医生想当面跟您说一下，方便现在接个电话吗？",
        "您好，您预约的复诊时间提前了，需要跟您确认一下，方便现在通话吗？",
    ],
    "客户": [
        "您好，我是之前跟您对接的客户，合同这边有个条款需要马上跟你确认，方便现在说两句吗？",
    ],
    "默认": [
        "喂，你现在方便吗？这边有点急事需要你处理一下，能先回个电话吗？",
    ],
}


class MockProvider(AIProvider):
    name = "mock"

    def generate_excuse(self, scene_type: str, contact_role: str, tone: str = "自然") -> str:
        pool = _EXCUSES.get(contact_role) or _EXCUSES["默认"]
        # 用角色+场景做随机种子之外的稳定多样性，直接随机即可（Demo 场景）
        return random.choice(pool)

    def generate_voice(self, text: str) -> VoiceResult:
        audio = _synth_speech_like_wav(text)
        return VoiceResult(
            audio_bytes=audio,
            format="wav",
            duration_ms=_measure_duration(audio),
            provider=self.name,
        )


def _measure_duration(wav_bytes: bytes) -> int:
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as w:
        return int(w.getnframes() / w.getframerate() * 1000)


def _synth_speech_like_wav(text: str, sample_rate: int = _SAMPLE_RATE) -> bytes:
    """合成一段多音调提示音，模拟一句中文的抑扬顿挫。

    用文本长度轻微影响音高走势，让不同理由听起来略有区别。
    """
    del text  # 占位：真实 TTS 会用文本合成；这里仅用固定韵律
    # (频率Hz, 时长秒) 序列
    tones = [
        (300, 0.14), (330, 0.12), (370, 0.14), (410, 0.16),
        (350, 0.14), (390, 0.18), (330, 0.12), (300, 0.20),
    ]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)  # 16-bit PCM
        w.setframerate(sample_rate)
        frames = bytearray()
        for freq, sec in tones:
            n = int(sample_rate * sec)
            for i in range(n):
                t = i / n
                # 淡入淡出包络，避免爆音
                env = min(1.0, t * 30) * min(1.0, (1 - t) * 30)
                sample = int(11000 * env * math.sin(2 * math.pi * freq * i / sample_rate))
                frames += struct.pack("<h", sample)
        w.writeframes(bytes(frames))
    return buf.getvalue()
