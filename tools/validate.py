#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""题库校验器（进仓库，可独立运行 / 可被构建调用 / 可接 CI）

用法：
    python tools/validate.py            # 校验 data/questions.json
    python tools/validate.py --quiet    # 只输出结论（供脚本调用）

检查项：
    1. 结构完整         industries / roles / questions
    2. 必填字段         每题 id/type/level/difficulty/q/intent/keywords/followups/minutes
    3. id 唯一          同 id 出现两次会破坏纠错反馈定位
    4. 枚举合法         level 与 type 必须在允许集合内
    5. 标签合法         tags 必须来自 knowledge_tags.json 的词典
    6. 分层达标         每岗位「校招」「高级」各 ≥ MIN_PER_LEVEL 题（防退化）
    7. 重复题面         全库题面不得重复
    8. rubric 权重      各维度 weight 之和 ≈ 1.0

退出码：0 = 通过，1 = 有错误
"""
import json
import os
import sys
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

VALID_LEVELS = {'校招', '初级', '中级', '高级', '通用', '试讲'}
VALID_TYPES = {
    '自我介绍', '专业知识', '项目经历', '场景题', '行为面试',
    '压力题', '反问', '综合分析', '试讲', '简历深挖',
}
REQUIRED_FIELDS = ['id', 'type', 'level', 'difficulty', 'q',
                   'intent', 'keywords', 'followups', 'minutes']
MIN_PER_LEVEL = 6          # 校招 / 高级 每岗位最低题量
TARGET_LEVELS = ['校招', '高级']
WEIGHT_TOL = 0.02          # rubric 权重和容差


def _load(name):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def run(verbose=True):
    """返回 (errors, warnings, stats)。errors 非空即视为不通过。"""
    errors, warnings = [], []
    stats = {}

    db = _load('questions.json')
    tagdict = _load('knowledge_tags.json')
    valid_tags = {t['name'] for t in tagdict.get('tags', []) if t.get('name')}

    industries = db.get('industries')
    if not isinstance(industries, list) or not industries:
        return ['questions.json 缺少 industries 数组或为空'], warnings, stats

    total_q = 0
    seen_ids = {}
    seen_text = {}
    role_count = 0
    level_short = []          # 未达标的 岗位×层级

    for ind in industries:
        iname = ind.get('industry', '?')
        roles = ind.get('roles')
        if not isinstance(roles, list) or not roles:
            errors.append(f'[{iname}] 缺少 roles 或为空')
            continue
        for r in roles:
            rname = r.get('role', '?')
            role_count += 1
            qs = r.get('questions')
            if not isinstance(qs, list) or not qs:
                errors.append(f'[{iname}/{rname}] 缺少 questions 或为空')
                continue

            # 6. 分层达标
            lv = collections.Counter(q.get('level') for q in qs)
            for target in TARGET_LEVELS:
                n = lv.get(target, 0)
                if n < MIN_PER_LEVEL:
                    level_short.append(f'{iname}/{rname}·{target}={n}')

            # 8. rubric 权重
            rub = r.get('rubric') or {}
            dims = rub.get('dimensions') or []
            if dims:
                s = sum(float(d.get('weight') or 0) for d in dims)
                if abs(s - 1.0) > WEIGHT_TOL:
                    errors.append(f'[{iname}/{rname}] rubric 权重和={s:.3f}（应≈1.0）')

            for q in qs:
                total_q += 1
                qid = q.get('id')
                text = (q.get('q') or '').strip()
                label = f'[{iname}/{rname}] {qid or "(无id)"} {(text[:24] or "(空题干)")}'

                # 2. 必填字段（只查键是否存在；keywords/followups 允许空数组）
                missing = [f for f in REQUIRED_FIELDS if f not in q]
                if missing:
                    errors.append(f'{label} 缺字段: {missing}')
                if not text:
                    errors.append(f'{label} 题干为空')

                # 3. id 唯一
                if qid:
                    if qid in seen_ids:
                        errors.append(f'{label} id 重复（另见 {seen_ids[qid]}）')
                    else:
                        seen_ids[qid] = f'{iname}/{rname}'

                # 4. 枚举合法
                if q.get('level') and q['level'] not in VALID_LEVELS:
                    errors.append(f'{label} level 非法: {q["level"]}')
                if q.get('type') and q['type'] not in VALID_TYPES:
                    errors.append(f'{label} type 非法: {q["type"]}')

                # 5. 标签合法
                bad = [t for t in (q.get('tags') or []) if t not in valid_tags]
                if bad:
                    errors.append(f'{label} 标签不在词典: {bad}')

                # 7. 重复题面
                if text:
                    if text in seen_text:
                        warnings.append(f'题面重复: 「{text[:36]}」 见 {seen_text[text]} 与 {iname}/{rname}')
                    else:
                        seen_text[text] = f'{iname}/{rname}'

    if level_short:
        errors.append('分层未达标（校招/高级 需各 ≥%d）：%s' % (MIN_PER_LEVEL, '；'.join(level_short[:12])
                                                          + ('…' if len(level_short) > 12 else '')))

    stats = {
        'industries': len(industries),
        'industry_names': len({i.get('industry') for i in industries}),
        'roles': role_count,
        'questions': total_q,
        'unique_ids': len(seen_ids),
        'unique_texts': len(seen_text),
        'tags': len(valid_tags),
    }
    return errors, warnings, stats


def main():
    quiet = '--quiet' in sys.argv
    errors, warnings, stats = run()

    if not quiet:
        print('=' * 46)
        print('题库校验  data/questions.json')
        print('=' * 46)
        print('  行业 %d（归并后 %d）  岗位 %d  题量 %d'
              % (stats.get('industries', 0), stats.get('industry_names', 0),
                 stats.get('roles', 0), stats.get('questions', 0)))
        print('  唯一 id %d   唯一题面 %d   标签词典 %d'
              % (stats.get('unique_ids', 0), stats.get('unique_texts', 0), stats.get('tags', 0)))
        print('-' * 46)
        if warnings:
            print('  警告 %d 条：' % len(warnings))
            for w in warnings[:8]:
                print('    · ' + w)
            if len(warnings) > 8:
                print('    … 其余 %d 条' % (len(warnings) - 8))
        if errors:
            print('  错误 %d 条：' % len(errors))
            for e in errors[:20]:
                print('    ✗ ' + e)
            if len(errors) > 20:
                print('    … 其余 %d 条' % (len(errors) - 20))
            print('-' * 46)
            print('结果：FAIL')
        else:
            print('结果：PASS' + ('（含 %d 条警告）' % len(warnings) if warnings else ''))
    else:
        print('PASS' if not errors else 'FAIL: ' + '；'.join(errors[:3]))

    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
