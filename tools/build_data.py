#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据构建管线：一条命令把源数据变成线上可用的产物

    data/questions.json  ──┬─→  data/questions/ind-N.json   （按行业分块，前端懒加载）
     （唯一源，手工/脚本写入）  ├─→  data/catalog.json          （行业/岗位索引 + 预统计）
                            └─→  data/tag_index.json        （69 标签 × 题量 × 行业）

用法：
    python tools/build_data.py              # 校验 + 构建（推荐，发布前必跑）
    python tools/build_data.py --check      # 只校验，不写文件
    python tools/build_data.py --skip-check # 跳过校验直接构建（不推荐）

为什么要这个脚本：
    以前改完 data/questions.json 必须记得另外跑一次分块生成，否则线上仍读旧题
    （已实际发生过：改了 971 题但忘记重建分块，线上题池没变）。
    现在把「校验 → 分块 → catalog → tag_index」收进一条命令，漏步骤不可能发生。
"""
import argparse
import collections
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import validate as V  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')


def dump(path, obj):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


def merge_industries(raw):
    """按行业名归并（源文件里实体行业/公务员/创意各拆成多个 sector 分块）

    归并时必须保留 rubric 与 aliases —— 简历×岗位匹配要用 rubric 的能力维度做岗位画像。
    """
    order, by = [], {}
    for ind in raw.get('industries', []):
        name = ind['industry']
        if name not in by:
            by[name] = {'industry': name, 'roles': [], '_map': {}}
            order.append(name)
        tgt = by[name]
        for r in ind.get('roles', []):
            rn = r['role']
            if rn in tgt['_map']:
                ex = tgt['_map'][rn]
                ex['questions'] = (ex.get('questions') or []) + (r.get('questions') or [])
                if r.get('levels'):
                    ex['levels'] = sorted(set((ex.get('levels') or []) + r['levels']))
                if r.get('aliases'):
                    ex['aliases'] = sorted(set((ex.get('aliases') or []) + list(r['aliases'])))
                if not ex.get('rubric') and r.get('rubric'):
                    ex['rubric'] = r['rubric']
            else:
                nr = {
                    'role': rn,
                    'aliases': sorted(set(r.get('aliases') or [])),
                    'levels': sorted(set(r.get('levels') or [])),
                    'rubric': r.get('rubric') or {},
                    'questions': json.loads(json.dumps(r.get('questions') or [])),
                }
                tgt['_map'][rn] = nr
                tgt['roles'].append(nr)
    return [by[n] for n in order]


def build_tag_index(merged, tagdict):
    domain = {t['name']: t.get('domain', '') for t in tagdict.get('tags', []) if t.get('name')}
    tags = collections.OrderedDict()
    for ind in merged:
        for r in ind['roles']:
            for q in r['questions']:
                for t in set(q.get('tags') or []):
                    e = tags.setdefault(t, {'domain': domain.get(t, ''), 'total': 0, 'byIndustry': {}})
                    e['total'] += 1
                    e['byIndustry'][ind['industry']] = e['byIndustry'].get(ind['industry'], 0) + 1
    for e in tags.values():
        e['byIndustry'] = dict(sorted(e['byIndustry'].items(), key=lambda kv: -kv[1]))
    return {
        'generated_at': time.strftime('%Y-%m-%d'),
        'tag_count': len(tags),
        'tags': tags,
    }


def main():
    ap = argparse.ArgumentParser(description='题库数据构建')
    ap.add_argument('--check', action='store_true', help='只校验，不生成产物')
    ap.add_argument('--skip-check', action='store_true', help='跳过校验直接构建')
    args = ap.parse_args()

    # ── 1. 校验 ──
    if not args.skip_check:
        errors, warnings, stats = V.run()
        if errors:
            print('校验未通过，已中止构建：')
            for e in errors[:15]:
                print('  ✗ ' + e)
            if len(errors) > 15:
                print('  … 其余 %d 条' % (len(errors) - 15))
            return 1
        print('校验通过：%d 岗 / %d 题%s'
              % (stats['roles'], stats['questions'],
                 ('（%d 条警告）' % len(warnings)) if warnings else ''))
        if args.check:
            return 0
    else:
        print('⚠ 已跳过校验')

    # ── 2. 归并行业 ──
    with open(os.path.join(DATA, 'questions.json'), encoding='utf-8') as f:
        raw = json.load(f)
    with open(os.path.join(DATA, 'knowledge_tags.json'), encoding='utf-8') as f:
        tagdict = json.load(f)

    merged = merge_industries(raw)

    outdir = os.path.join(DATA, 'questions')
    os.makedirs(outdir, exist_ok=True)

    # ── 3. 分块 + catalog ──
    catalog = {'meta': {}, 'industries': []}
    total_roles = total_q = 0
    for i, ind in enumerate(merged):
        roles_meta = []
        for r in ind['roles']:
            rc = len(r.get('questions') or [])
            total_roles += 1
            total_q += rc
            roles_meta.append({'role': r['role'], 'levels': r.get('levels') or [], 'questionCount': rc})
        fn = 'questions/ind-%d.json' % i
        dump(os.path.join(DATA, fn), {'industry': ind['industry'], 'roles': ind['roles']})
        catalog['industries'].append({
            'industry': ind['industry'],
            'index': i,
            'file': fn,
            'questionCount': sum(x['questionCount'] for x in roles_meta),
            'roles': roles_meta,
        })

    catalog['meta'] = {
        'source': raw.get('meta'),
        'industries': len(merged),
        'roles': total_roles,
        'questions': total_q,
        'built_at': time.strftime('%Y-%m-%d %H:%M:%S'),
    }
    dump(os.path.join(DATA, 'catalog.json'), catalog)

    # ── 4. tag_index ──
    tdb = build_tag_index(merged, tagdict)
    dump(os.path.join(DATA, 'tag_index.json'), tdb)

    # ── 5. 报告 ──
    print('构建完成：%d 行业 / %d 岗 / %d 题' % (len(merged), total_roles, total_q))
    for c in catalog['industries']:
        p = os.path.join(DATA, c['file'])
        print('  %-22s %4d 题  %6.1f KB' % (c['industry'], c['questionCount'], os.path.getsize(p) / 1024))
    print('  catalog.json    %6.1f KB' % (os.path.getsize(os.path.join(DATA, 'catalog.json')) / 1024))
    print('  tag_index.json  %6.1f KB（%d 标签）'
          % (os.path.getsize(os.path.join(DATA, 'tag_index.json')) / 1024, tdb['tag_count']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
