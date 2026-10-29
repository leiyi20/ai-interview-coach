#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
语音电话式 AI 模拟面试 —— 题库筛选 + 口语化改写工具

依据产品决策 #3：
  - 保留五类题型：自我介绍 / 项目经历 / 场景题 / 行为面试 / 压力题
  - 公务员体系（sector 含体制内信号）额外保留「综合分析」
  - 剔除：专业知识（多需写代码/画图/公式）、反问（候选人问面试官）、试讲（需现场讲授）
  - 对保留题用正则检测「写代码 / 画图 / 公式推导」指令，命中则硬剔除
  - 对保留题做口语化改写，生成 spoken_prompt 字段

改写策略：
  - 默认启发式（heuristic）：不依赖任何外部 key，可立即跑出可用底稿
  - 升级路径：配置环境变量 VOICE_LLM_KEY / VOICE_LLM_BASE / VOICE_LLM_MODEL 后
    以 --llm 运行，可批量调用大模型做更自然的口语化精修（脚本内置调用骨架）

输入：interview_data/questions.json
输出：voice-interview/data/questions_voice.json + 控制台统计
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "..", "interview_data", "questions.json")
OUT_DIR = os.path.join(BASE, "data")
OUT = os.path.join(OUT_DIR, "questions_voice.json")

# ---- 题型策略 -------------------------------------------------------------
# 主保留类（决策 #3 明确优先的五类）
KEEP_TYPES = {"自我介绍", "项目经历", "场景题", "行为面试", "压力题"}
# 仅对体制内岗位额外保留（口语讨论型，适配电话）
EXTRA_CIVSERV_TYPES = {"综合分析"}
# 直接剔除（不适合语音口述）
DROP_TYPES = {"专业知识", "反问", "试讲"}

# 写代码 / 画图 / 公式推导 检测（命中则硬剔除，避免口头无法完成的题）
CODE_DRAW_FORMULA = re.compile(
    r"(写\s*(一?[段个]\s*)?(代码|程序|脚本|算法)|"
    r"画\s*(一?[个张]\s*)?(图|架构图|流程图|UML|原型|草图|时序图|ER图)|"
    r"白板|手写\s*(代码|算法|公式)|"
    r"推导\s*(公式|过程|证明)|"
    r"给出\s*(公式|数学推导|伪代码|推导)|"
    r"LeetCode|力扣|"
    r"SQL\s*(写|查询|实现)|"
    r"写\s*(出\s*)?正则|算法题|编程题|上机|机试|"
    r"用代码实现|代码实现|手撕|默写代码)",
    re.IGNORECASE,
)

# ---- 口语化改写规则 -------------------------------------------------------
# 每条 (正则, 替换模板)，first match wins；替换后做清理与开场白补全
REPLACEMENTS = [
    (r"请\s*描述", "能不能描述一下"),
    (r"请\s*举例说明", "能不能举一个"),
    (r"请\s*举例", "能不能举个例子"),
    (r"请\s*分析", "我想听听你的分析，"),
    (r"请\s*简述", "简单说说"),
    (r"简述", "简单说说"),
    (r"如何理解", "你是怎么理解"),
    (r"如何处理", "你会怎么处理"),
    (r"如何解决", "你会怎么解决"),
    (r"你认为", "在你看来"),
    (r"你觉得", "在你看来"),
    (r"请\s*谈谈", "我们来聊聊"),
    (r"请\s*说明", "能不能说明一下"),
    (r"请\s*说出", "能不能说出"),
    (r"请\s*讲出", "能不能讲讲"),
    (r"请\s*列出", "能不能列出"),
    (r"请\s*解释", "能不能解释一下"),
    (r"请\s*讲", "能不能讲讲"),
    (r"请\s*问", "我想问问"),
]

# 适合用作开场白的句式（当改写后语句仍非疑问/祈使时补充）
OPENERS_BY_TYPE = {
    "自我介绍": "我们先从自我介绍开始吧。",
    "项目经历": "我想了解一下你做过的项目，",
    "场景题": "我们来聊一个场景，",
    "行为面试": "我想听你讲一个真实的经历，",
    "压力题": "接下来这个问题可能会有点挑战，",
    "综合分析": "对于这个现象，",
}
GENERIC_OPENER = "我们聊一下，"

INTERROGATIVE = re.compile(r"[？?]|吗|呢|怎么|为什么|能否|能不能|是否|什么|哪些|如何|几分")


def strip_please_prefix(s: str) -> str:
    """去掉开头冗余的『请』『请先』『请简单』等，避免口语生硬。"""
    s = re.sub(r"^请\s*(先\s*)?(简单\s*)?(用\s*[^，。]*?\s*)?", "", s)
    return s.strip()


def rewrite_heuristic(q: str, qtype: str):
    original = q.strip().rstrip("。．. ")
    # 0) 自我介绍整体模板化（原题常带冗长约束，口播时只需自然开场）
    if qtype == "自我介绍":
        spoken = ("我们先从自我介绍开始吧。用两分钟介绍一下你自己，"
                  "挑一个你最拿得出手的项目讲讲，也说说你为什么对这个岗位感兴趣。")
        return spoken, "heuristic"
    s = original
    # 1) 安全变换（first match wins）
    for pat, rep in REPLACEMENTS:
        if re.search(pat, s):
            s = re.sub(pat, rep, s, count=1)
            break
    # 2) 清理残留『请』开头（兜底）
    if s.startswith("请"):
        s = re.sub(r"^请\s*", "能不能", s, count=1)
    # 3) 收尾标点
    if not s.endswith(("？", "?", "。", "！", "!")):
        s += "？" if INTERROGATIVE.search(s) else "。"
    elif s.endswith("。"):
        if INTERROGATIVE.search(s):
            s = s[:-1] + "？"
    # 4) 仍非疑问/祈使 → 补开场白
    if not INTERROGATIVE.search(s) and not s.endswith("？"):
        opener = OPENERS_BY_TYPE.get(qtype, GENERIC_OPENER)
        if not s.startswith(opener):
            s = opener + s
    s = s.strip()
    # 5) 与原句几乎一致 → 标记为 verbatim（原句已口语化，直接复用，无需 LLM）
    method = "heuristic"
    if abs(len(s) - len(original)) <= 2 and s[:6] == original[:6]:
        method = "verbatim"
    return s, method


def llm_rewrite_batch(items, api_key, base, model):
    """
    升级路径骨架：配置环境变量后以 --llm 运行。
    此处仅占位，真实实现调用 OpenAI 兼容接口批量精修 spoken_prompt。
    未配置时返回 (items, False) 表示未启用。
    """
    if not api_key:
        return items, False
    # 真实调用逻辑在接入可用 key 后填充（保持工具可运行、不阻塞）。
    # 伪代码：
    #   for it in items:
    #       it["spoken_prompt"] = call_chat(base, api_key, model,
    #           f"把这道面试题改写成自然口语、像电话里面试官会说的话：{it['q']}")
    #       it["rewrite_method"] = "llm"
    return items, False


def is_civserv(role_obj, industry):
    text = (industry + " " + role_obj.get("role", "") + " " +
            " ".join(role_obj.get("aliases", []))).lower()
    return any(k in text for k in
               ["公务员", "事业", "教师编", "特岗", "军队文职", "国企", "央企",
                "civserv", "体制内", "选调", "公考"])


def main():
    use_llm = "--llm" in sys.argv
    with open(SRC, "r", encoding="utf-8") as f:
        data = json.load(f)

    stats = {
        "raw_questions": 0,
        "kept_by_type": {},
        "dropped_by_type": {},
        "dropped_code_draw": 0,
        "needs_llm_count": 0,
        "by_industry": {},
        "by_level": {},
    }

    out_roles = []
    for ind in data.get("industries", []):
        industry = ind.get("industry", "")
        sector = ind.get("sector")
        civserv = is_civserv({}, industry)  # 行业级判断优先
        for role in ind.get("roles", []):
            # 若行业未命中，再按岗位判断
            if not civserv:
                civserv = is_civserv(role, industry)
            kept = []
            for q in role.get("questions", []):
                stats["raw_questions"] += 1
                qtype = q.get("type", "")
                # 题型过滤
                if qtype in DROP_TYPES:
                    stats["dropped_by_type"][qtype] = stats["dropped_by_type"].get(qtype, 0) + 1
                    continue
                if qtype in EXTRA_CIVSERV_TYPES and not civserv:
                    stats["dropped_by_type"][qtype] = stats["dropped_by_type"].get(qtype, 0) + 1
                    continue
                if qtype not in KEEP_TYPES and qtype not in EXTRA_CIVSERV_TYPES:
                    stats["dropped_by_type"][qtype] = stats["dropped_by_type"].get(qtype, 0) + 1
                    continue
                # 代码/画图/公式检测
                if CODE_DRAW_FORMULA.search(q.get("q", "")):
                    stats["dropped_code_draw"] += 1
                    continue
                # 口语化改写
                spoken, method = rewrite_heuristic(q.get("q", ""), qtype)
                item = {
                    "id": q.get("id"),
                    "type": qtype,
                    "level": q.get("level"),
                    "difficulty": q.get("difficulty"),
                    "q": q.get("q"),
                    "spoken_prompt": spoken,
                    "intent": q.get("intent"),
                    "followups": q.get("followups", []),
                    "keywords": q.get("keywords", []),
                    "minutes": q.get("minutes"),
                    "tags": q.get("tags", []),
                    "rewrite_method": method,
                }
                if method == "verbatim":
                    stats["needs_llm_count"] += 1
                kept.append(item)

            if kept:
                stats["kept_by_type"].update(
                    {t: stats["kept_by_type"].get(t, 0) + sum(1 for x in kept if x["type"] == t)
                     for t in set(x["type"] for x in kept)})
                lvl = role.get("levels", [])
                for t in set(x["level"] for x in kept):
                    stats["by_level"][t] = stats["by_level"].get(t, 0) + sum(1 for x in kept if x["level"] == t)
                stats["by_industry"][industry] = stats["by_industry"].get(industry, 0) + len(kept)
                out_roles.append({
                    "industry": industry,
                    "sector": sector,
                    "role": role.get("role"),
                    "aliases": role.get("aliases", []),
                    "levels": lvl,
                    "civserv": civserv,
                    "question_count": len(kept),
                    "questions": kept,
                })

    # LLM 升级路径
    if use_llm:
        api_key = os.environ.get("VOICE_LLM_KEY")
        base = os.environ.get("VOICE_LLM_BASE", "https://api.openai.com/v1")
        model = os.environ.get("VOICE_LLM_MODEL", "gpt-4o-mini")
        all_items = [q for r in out_roles for q in r["questions"]]
        all_items, enabled = llm_rewrite_batch(all_items, api_key, base, model)
        if enabled:
            print("[llm] 已批量精修 spoken_prompt")
        else:
            print("[llm] 未检测到 VOICE_LLM_KEY，回退启发式结果（如需精修请配置环境变量后重跑）")

    os.makedirs(OUT_DIR, exist_ok=True)
    result = {
        "meta": {
            "name": "语音电话式 AI 模拟面试 · 语音适配题库",
            "source": "interview_data/questions.json",
            "generated_by": "voice_filter.py",
            "policy": "保留 自我介绍/项目经历/场景题/行为面试/压力题(+体制内综合分析)；剔除 专业知识/反问/试讲 及 写代码/画图/公式题",
            "scoring": "评估阶段套用七维语音评分模板（见 voice_scoring_template.json）",
        },
        "stats": stats,
        "roles": out_roles,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 控制台报告
    total_kept = sum(r["question_count"] for r in out_roles)
    print("=" * 56)
    print("语音题库筛选完成")
    print("-" * 56)
    print(f"原始题目总数      : {stats['raw_questions']}")
    print(f"保留题目总数      : {total_kept}")
    print(f"代码/画图/公式剔除 : {stats['dropped_code_draw']}")
    print(f"原句复用(已口语化) : {stats['needs_llm_count']}")
    print("-" * 56)
    print("按题型保留:")
    for t, c in sorted(stats["kept_by_type"].items(), key=lambda x: -x[1]):
        print(f"  {t:<6} {c}")
    print("按题型剔除:")
    for t, c in sorted(stats["dropped_by_type"].items(), key=lambda x: -x[1]):
        print(f"  {t:<6} {c}")
    print("-" * 56)
    print(f"覆盖岗位数        : {len(out_roles)}")
    print(f"输出文件          : {OUT}")
    print("=" * 56)


if __name__ == "__main__":
    main()
