#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""学科知识库同步工具：把「全学科知识库与作文素材」原文件的 Markdown 内容
转换为站点 /kb/ 使用的 kb/data/entries.json。

设计要点
--------
1. 原文件只读：本脚本绝不写、不改、不移动源目录中的任何文件。
2. 幂等：条目 id 由「学科 + 二级标题」哈希决定，重复运行 id 稳定，旧链接不失效。
3. 单一真源：网站内容完全由原文件派生，原文件改动后重新运行即可保持一致。

用法
----
    python tools/sync_kb.py                 # 默认源目录 + 默认输出 kb/data/entries.json
    python tools/sync_kb.py --src "D:\\路径\\output" --out "kb\\data\\entries.json"
    python tools/sync_kb.py --check         # 只校验，不写文件

默认源目录可通过环境变量 KB_SRC 覆盖。
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time

DEFAULT_SRC = os.environ.get(
    'KB_SRC',
    r'D:\Marvis\Data\User\oAN1i2aIP2CorgRF5AydNjYJaKzk\workspace\conv_cec154b7a4f2428ba10a99f8492dce72\output',
)
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'kb', 'data', 'entries.json')

# 语文扩展篇（作文素材库·扩展篇）原文件位于独立的只读源目录
DEFAULT_SRC_EXT = os.environ.get(
    'KB_SRC_EXT',
    r'D:\Marvis\Data\User\oAN1i2aIP2CorgRF5AydNjYJaKzk\workspace\conv_b6ec425b168c418291e253eb386ecd3e\output',
)

# (文件名, 学科, 独立源目录；None 表示使用主源目录)
FILES = [
    ('全学科知识库总索引.md', '总览', None),
    ('高中语文高考议论文作文素材库.md', '语文', None),
    ('高中数学核心考点全典（人教版2019版）.md', '数学', None),
    ('高中英语核心考点全典（人教版2019版）.md', '英语', None),
    ('高中物理核心考点全典（人教版2019版）.md', '物理', None),
    ('高中化学方程式全典（人教版2019版）.md', '化学', None),
    ('高中生物核心考点全典（人教版2019版）.md', '生物', None),
    ('高中语文高考议论文作文素材库_扩展篇.md', '语文', DEFAULT_SRC_EXT),
]


def strip_front_matter(text):
    t = text.lstrip('\ufeff')
    if t.startswith('---'):
        end = t.find('\n---', 3)
        if end != -1:
            t = t[end + 4:]
    return t.lstrip('\n')


def clean_inline(s):
    s = re.sub(r'\*\*([^*]+)\*\*', r'\1', s)
    s = re.sub(r'`([^`]+)`', r'\1', s)
    s = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', s)
    return s.strip()


def make_summary(body):
    """摘要优先级：正文段落 > 三级/四级标题 > 表格数据行 > 原文首句。"""
    heads, table_rows = [], []
    first_para = ''
    for line in body.split('\n'):
        s = line.strip()
        if not s:
            continue
        if set(s) <= set('-:| '):
            continue
        h = re.match(r'^#{3,4}\s+(.+)$', s)
        if h:
            t = clean_inline(h.group(1))
            if t and t not in heads:
                heads.append(t)
            continue
        if s.startswith('|'):
            cells = [clean_inline(c) for c in s.strip('|').split('|')]
            cells = [c for c in cells if c]
            if cells and not set(''.join(cells)) <= set('-: '):
                table_rows.append(cells)
            continue
        if s.startswith(('>', '-', '*', '1.')):
            continue
        if not first_para:
            first_para = clean_inline(s)
    if first_para:
        return first_para[:95]
    if heads:
        return ' / '.join(heads[:3])[:95]
    if table_rows:
        data = table_rows[1:] if len(table_rows) > 1 else table_rows
        return ' · '.join(' '.join(r[:2]) for r in data[:2])[:95]
    return re.sub(r'\s+', ' ', clean_inline(body))[:95]


def make_tags(title, body):
    tags = []
    for m in re.finditer(r'^###\s+(.+)$', body, re.M):
        t = clean_inline(m.group(1))
        t = re.split(r'[（(|·:：]', t)[0].strip()
        if t and len(t) <= 12 and t not in tags:
            tags.append(t)
        if len(tags) >= 4:
            break
    if not tags:
        t = re.split(r'[（(|·:：]', clean_inline(title))[0].strip()
        if t:
            tags.append(t[:12])
    return tags


def split_h2(text):
    """按二级标题切分；H1 文档标题丢弃。返回 [(title, body)]。"""
    out, cur, buf = [], None, []
    for line in text.split('\n'):
        m = re.match(r'^##\s+(.+?)\s*$', line)
        if m:
            if cur is not None:
                out.append((cur, '\n'.join(buf).strip()))
            cur, buf = clean_inline(m.group(1)), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out.append((cur, '\n'.join(buf).strip()))
    return out


def split_h2_with_h1(text):
    """按二级标题切分，并记录所属一级标题（章）。返回 [(h1, title, body)]。"""
    out, cur, buf, h1 = [], None, [], ''
    for line in text.split('\n'):
        m1 = re.match(r'^#\s+(.+?)\s*$', line)
        if m1:
            if cur is not None:
                out.append((h1, cur, '\n'.join(buf).strip()))
                cur, buf = None, []
            h1 = clean_inline(m1.group(1))
            continue
        m = re.match(r'^##\s+(.+?)\s*$', line)
        if m:
            if cur is not None:
                out.append((h1, cur, '\n'.join(buf).strip()))
            cur, buf = clean_inline(m.group(1)), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out.append((h1, cur, '\n'.join(buf).strip()))
    return out


def entry_id(subject, title, salt=''):
    key = subject + '|' + title + (('|' + salt) if salt else '')
    return 'kb-' + hashlib.md5(key.encode('utf-8')).hexdigest()[:8]


def build(src):
    entries, files_meta = [], []
    for name, subject, base in FILES:
        src_dir = base or src
        path = os.path.join(src_dir, name)
        if not os.path.exists(path):
            raise SystemExit('缺少原文件：' + path)
        raw = open(path, encoding='utf-8').read()
        stamp = time.strftime('%Y-%m-%dT%H:%M:%S+08:00', time.localtime(os.path.getmtime(path)))
        body_text = strip_front_matter(raw)
        if base is None:
            parts = [(None, t, b) for t, b in split_h2(body_text)]
        else:
            parts = split_h2_with_h1(body_text)
        # 同一学科的第二份及以后文件加文件名盐，保证 id 唯一且历史条目 id 不变
        salt = '' if base is None else name
        files_meta.append({
            'file': name, 'subject': subject,
            'bytes': len(raw.encode('utf-8')),
            'updatedAt': stamp, 'entries': len(parts),
        })
        for h1, title, body in parts:
            if not title and not body:
                continue
            if h1 and h1 not in title:
                title = h1 + ' · ' + title
            entries.append({
                'id': entry_id(subject, title, salt),
                'subject': subject,
                'title': title,
                'tags': make_tags(title, body),
                'summary': make_summary(body),
                'body': body,
                'author': '原文件同步 · ' + name,
                'createdAt': stamp,
                'updatedAt': stamp,
            })
    entries.sort(key=lambda e: (e['subject'], e['title']))
    return {
        'source': '学科知识库原文件同步',
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%S+08:00'),
        'count': len(entries),
        'files': files_meta,
        'entries': entries,
    }


def validate(data):
    errs = []
    ids, empty = set(), 0
    for e in data['entries']:
        if e['id'] in ids:
            errs.append('重复 id：' + e['id'])
        ids.add(e['id'])
        if len(e['body']) < 20:
            empty += 1
    if empty:
        errs.append('正文过短条目 %d 条' % empty)
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=DEFAULT_SRC)
    ap.add_argument('--out', default=DEFAULT_OUT)
    ap.add_argument('--check', action='store_true', help='只校验不写文件')
    args = ap.parse_args()

    if not os.path.isdir(args.src):
        raise SystemExit('源目录不存在：' + args.src)

    data = build(args.src)
    errs = validate(data)

    print('条目总数：%d ；学科数：%d' % (data['count'], len({e['subject'] for e in data['entries']})))
    for fm in data['files']:
        print('  %-40s %-4s %7.1f KB  %3d 条  %s' % (
            fm['file'], fm['subject'], fm['bytes'] / 1024, fm['entries'], fm['updatedAt'][:10]))
    if errs:
        print('校验提醒：' + '；'.join(errs))
    if args.check:
        print('（--check 模式，未写入文件）')
        return

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('已写入 %s（%.1f KB）' % (args.out, os.path.getsize(args.out) / 1024))
    print('原文件未被修改；重新运行本脚本即可让网站内容与原文件保持一致。')


if __name__ == '__main__':
    main()
