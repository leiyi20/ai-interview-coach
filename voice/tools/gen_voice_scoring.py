#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音电话式 AI 模拟面试 —— 七维评分模板生成

依据产品决策 #8：
  - 在 6 维通用评分表（scoring_template.json）基础上新增「表达与口述」维度，权重 0.15
  - 原六维权重统一 ×0.85（0.85 + 0.15 = 1.0）
  - 关键片段回放：逐题截取 20-40 秒作答片段供回放复核
  - 追加语音专属否决项 / 评分指南 / AI 评分输入字段

输入：interview_data/scoring_template.json
输出：voice-interview/data/voice_scoring_template.json
"""
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "..", "interview_data", "scoring_template.json")
OUT_DIR = os.path.join(BASE, "data")
OUT = os.path.join(OUT_DIR, "voice_scoring_template.json")

NEW_DIM = {
    "name": "表达与口述",
    "weight": 0.15,
    "observation_focus": (
        "口语呈现本身：流畅度、填充词密度（嗯/啊/这个/然后）、语速与停顿是否得当、"
        "临场组织语言的速度、语气自信与平和度、被追问时的口述韧性。"
        "只评『怎么说』，不评『内容对错』——内容对错归入对应能力维度。"
    ),
    "levels": {
        "5": "口述流畅自然，几乎无填充词，语速适中、停顿得当；能用大白话把复杂的事讲清楚，临场组织语言快，被追问两层也不卡壳；语气自信平和，听得进去",
        "4": "表达较流畅，偶有不影响的填充词；结构基本清楚，个别地方啰嗦或重复；被追问能接住，整体让人听得下去",
        "3": "表达达标但啰嗦/重复明显，填充词偏多（这个/那个/然后）；讲到细节易卡顿，需要自己停顿整理；能把事讲清但费劲",
        "2": "口述明显吃力：大量填充词、语句破碎、长时间停顿；逻辑发散，常跑题或反复同一句；紧张已影响到理解",
        "1": "几乎无法口述：长时间沉默、答非所问，或语言组织严重障碍，无法传递有效信息"
    },
}

VOICE_VETO = [
    "全程无法口述 / 长时间沉默无有效作答（关键能力无法评估，报告标注『样本不足』而非低分）",
    "语音中出现明显辱骂、人身攻击或严重不遵从基本交流礼仪",
]
VOICE_GUIDELINES = [
    "『表达与口述』仅评估口语呈现（流畅度/填充词/语速/临场组织），不评估内容对错；内容对错归入对应能力维度",
    "关键片段回放：每题截取 20-40 秒作答音频/转写用于复核，避免凭整体印象打分",
    "填充词（嗯/啊/这个/然后）仅影响『表达与口述』，严禁计入专业/逻辑等维度",
    "沉默与停顿：5 秒内属正常思考；超过 12 秒无有效输出按『未作答』处理，相关维度给『样本不足』标注而非直接低分",
]
VOICE_AI_FIELDS = [
    "speech_fillers_rate", "speech_fluency", "avg_pause_sec", "words_per_min",
    "transcript", "answer_seconds", "read_seconds", "keyword_hits", "keyword_miss",
    "followup_rounds", "followup_hit_rate", "star_coverage", "semantic_score",
    "integrity_flags", "key_clip_refs"
]


def reweight(dims, factor=0.85):
    out = []
    for d in dims:
        nd = dict(d)
        nd["weight"] = round(d["weight"] * factor, 4)
        nd["voice_reweighted_from"] = d["weight"]
        out.append(nd)
    return out


def reweight_preset(preset, factor=0.85):
    out = {k: round(v * factor, 4) for k, v in preset.items()}
    out["表达与口述"] = 0.15
    # 修正舍入残差，保证和为 1.0
    total = round(sum(out.values()), 6)
    resid = round(1.0 - total, 4)
    if abs(resid) > 1e-6:
        # 把残差加到权重最大的维度上
        maxk = max(out, key=lambda k: out[k] if k != "表达与口述" else -1)
        out[maxk] = round(out[maxk] + resid, 4)
    return out


def main():
    with open(SRC, "r", encoding="utf-8") as f:
        tpl = json.load(f)

    orig_dims = tpl["dimensions"]
    new_dims = reweight(orig_dims, 0.85)
    new_dims.append(NEW_DIM)

    # 校验维度和
    s = round(sum(d["weight"] for d in new_dims), 6)
    assert abs(s - 1.0) < 1e-6, f"维度权重和应为 1.0，实际 {s}"

    # 预设重算
    new_presets = {}
    for name, preset in tpl.get("weight_presets", {}).items():
        new_presets[name] = reweight_preset(preset, 0.85)

    # 否决项 / 指南 / AI 字段 合并
    veto = list(tpl.get("veto_items", [])) + VOICE_VETO
    guidelines = list(tpl.get("scoring_guidelines", [])) + VOICE_GUIDELINES
    ai_map = dict(tpl.get("ai_scoring_mapping", {}))
    ai_map["input_fields"] = VOICE_AI_FIELDS
    ai_map["voice_note"] = "表达与口述 由语音特征（填充词率/流畅度/停顿/语速）与转写质量共同判定；视觉/声纹特征不计入内容维度"

    result = {
        "template_name": "语音电话式 AI 模拟面试 · 七维评分表（1-5分）",
        "version": "1.0",
        "based_on": "interview_data/scoring_template.json（6维 → 7维）",
        "reweight_rule": "原六维权重 ×0.85；新增『表达与口述』0.15；合计 1.0",
        "decision_8_ref": "语音文字统一七维；逐题关键片段回放 20-40 秒",
        "scale": tpl.get("scale"),
        "dimensions": new_dims,
        "weight_sum_check": round(sum(d["weight"] for d in new_dims), 6),
        "weight_presets": new_presets,
        "key_clip_replay": {
            "enabled": True,
            "clip_seconds": [20, 40],
            "per_question": True,
            "capture": "逐题记录用户作答音频/转写的关键片段，评分与报告回放时使用",
        },
        "decision_rules": tpl.get("decision_rules"),
        "veto_items": veto,
        "scoring_guidelines": guidelines,
        "ai_scoring_mapping": ai_map,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 校验并打印
    print("=" * 56)
    print("七维语音评分模板生成完成")
    print("-" * 56)
    print("维度权重（合计 %.2f）:" % result["weight_sum_check"])
    for d in new_dims:
        print(f"  {d['name']:<8} {d['weight']:.4f}")
    print("-" * 56)
    print("预设示例（default）:")
    for k, v in new_presets.get("default", {}).items():
        print(f"  {k:<8} {v:.4f}")
    print(f"  预设和: {round(sum(new_presets.get('default', {}).values()), 4)}")
    print("-" * 56)
    print(f"否决项 +{len(VOICE_VETO)} 条 / 指南 +{len(VOICE_GUIDELINES)} 条")
    print(f"输出文件: {OUT}")
    print("=" * 56)


if __name__ == "__main__":
    main()
