"""从旧工具 CampusFormAgent profile.json 只读提取真实字段目录（字段元数据）。

安全约束（AGENTS.md）：
- 只读取用户本地文件，不修改；
- 输出只允许字段标签/结构/计数/状态/选项等元数据；
- 绝不输出任何个人答案值（facts.value、records.*.value、resumeUnmapped 文本等）。

用法（仓库根）：
    python diagnostics/coverage/extract_field_catalog.py
    python diagnostics/coverage/extract_field_catalog.py --profile "C:\\path\\profile.json"

输出（diagnostics/coverage/）：
    field-catalog.json        真实字段目录（mappings 为主体，合并 pages/pending/semanticLinks）
    available-semantics.json  用户资料中"有值"的语义 key 名单（只有 key 与计数，无值）
    catalog-summary.md        按站点/状态的汇总
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_PROFILE = Path(
    os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")),
    "CampusFormAgent",
    "profile.json",
)

# 目标站点（任务书重点站点 + 其它有历史目录的站点）。
TARGET_DOMAINS = [
    "wecruit.hotjob.cn",
    "chinastock.zhiye.com",
    "starnet.zhiye.com",
    "zhonghuan.zhiye.com",
    "app.mokahr.com",
    "zhaopin.com",
    "xjnsyh2026.zhaopin.com",
    "zhaopin.sgcc.com.cn",
    "xyz.51job.com",
    "scbank.hotjob.cn",
    "recruitment.uco.com",
    "careers.eccom.com.cn",
    "webhr.shccig.com",
    "zhaopin.china-cdt.com",
]

DEFAULT_OPTIONS_LIMIT = 40


def normalize_key_text(value: str) -> str:
    """目录 join 用的规范化：NFKC、去首尾符号/空白、去必填星号，仅用于匹配同一字段。"""
    text = unicodedata.normalize("NFKC", value or "")
    text = text.replace("＊", "").replace("*", "")
    text = re.sub(r"[\s\W_]+", "", text, flags=re.UNICODE)
    return text.strip().lower()


def normalize_label(value: str) -> str:
    """展示用规范化：仅 NFKC + 去首尾空白 + 去结尾冒号/星号；保留原始中文语义。"""
    text = unicodedata.normalize("NFKC", value or "").strip()
    text = re.sub(r"[:：\s*＊]+$", "", text)
    return text


def domain_of_url(url: str) -> str:
    match = re.match(r"^https?://([^/]+)/?", url or "")
    return match.group(1).lower() if match else ""


def options_count(raw) -> int:
    """只统计选项数量。

    安全约束：旧工具 mappings 的 options 里可能保存着用户已选/已填的值
    （实测包含院校名等个人答案），按 AGENTS.md 绝不输出原始选项文本。
    """
    if not isinstance(raw, list):
        return 0
    return len(raw)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def script_like_mappings(data: dict) -> dict:
    return data.get("mappings") if isinstance(data.get("mappings"), dict) else {}


def extract_mappings(data: dict, options_limit: int) -> list[dict]:
    """mappings 是字段全量目录（922 条），每条都带 domain/label/section/type/..."""
    entries: list[dict] = []
    for signature, item in script_like_mappings(data).items():
        if not isinstance(item, dict):
            continue
        entry = {
            "id": f"map:{signature[:16]}",
            "signature": signature,
            "domain": item.get("domain") or domain_of_url(item.get("frameUrl") or ""),
            "label": normalize_label(item.get("label") or ""),
            "section": item.get("section") or "",
            "moduleTitle": item.get("moduleTitle") or "",
            "type": item.get("type") or "",
            "required": bool(item.get("required")),
            "optionsCount": options_count(item.get("options")),
            "sensitive": bool(item.get("sensitive")),
            "duplicateLabel": bool(item.get("duplicateLabel")),
            "slot": item.get("slot"),
            "scopePolicy": item.get("scopePolicy") or "",
            "status": item.get("status") or "",
            "seenCount": item.get("seenCount") or 0,
            "canonicalKey": None,
            "oldMethod": None,
            "pageValuePresent": None,
            "pageUrl": None,
            "sources": ["mappings"],
        }
        frame_url = item.get("frameUrl") or ""
        if frame_url:
            entry["frameUrl"] = frame_url
        entries.append(entry)
    return entries


def join_pages(data: dict, entries: list[dict], options_limit: int) -> int:
    """把 pages[].fields 的 canonicalKey/method/status 合并进 mappings 条目。

    返回"只存在于 pages、mappings 中没有"的字段数（这些会作为独立条目追加）。
    """
    # 索引：domain -> [(normalized_label, normalized_section, type, entry)]
    by_domain: dict[str, list[tuple[str, str, str, dict]]] = collections.defaultdict(list)
    for entry in entries:
        by_domain[entry["domain"]].append((
            normalize_key_text(entry["label"]),
            normalize_key_text(entry["section"] or entry["moduleTitle"]),
            entry["type"],
            entry,
        ))

    used: set[tuple[str, int]] = set()
    appended = 0
    for page_url, page in (data.get("pages") or {}).items():
        if not isinstance(page, dict):
            continue
        domain = domain_of_url(page_url)
        fields = page.get("fields") or []
        if not isinstance(fields, list):
            continue
        for field in fields:
            if not isinstance(field, dict):
                continue
            label = normalize_label(field.get("label") or "")
            section = field.get("section") or ""
            ftype = field.get("type") or ""
            nlabel, nsection = normalize_key_text(label), normalize_key_text(section)
            best = None
            best_score = -1
            for index, (mlabel, msection, mtype, entry) in enumerate(by_domain.get(domain, [])):
                if (domain, index) in used:
                    continue
                score = 0
                if mlabel == nlabel:
                    score += 4
                elif mlabel and nlabel and (nlabel in mlabel or mlabel in nlabel):
                    score += 2
                else:
                    continue
                if msection == nsection:
                    score += 2
                if mtype == ftype:
                    score += 1
                if score > best_score:
                    best, best_score = (index, entry), score
            payload = {
                "canonicalKey": field.get("canonicalKey"),
                "oldMethod": field.get("method"),
                "pageValuePresent": field.get("pageValuePresent"),
                "pageUrl": page_url,
            }
            if best is not None and best_score >= 4:
                index, entry = best
                used.add((domain, index))
                entry.update({k: v for k, v in payload.items() if v is not None})
                entry["sources"].append("pages")
                if field.get("reason"):
                    entry["oldReason"] = field.get("reason")
            else:
                appended += 1
                entry = {
                    "id": f"page:{domain}:{appended}",
                    "domain": domain,
                    "label": label,
                    "section": section,
                    "moduleTitle": section,
                    "type": ftype,
                    "required": bool(field.get("required")),
                    "optionsCount": options_count(field.get("options")),
                    "sensitive": False,
                    "duplicateLabel": False,
                    "slot": None,
                    "scopePolicy": "",
                    "status": field.get("status") or "",
                    "seenCount": 0,
                    "canonicalKey": field.get("canonicalKey"),
                    "oldMethod": field.get("method"),
                    "pageValuePresent": field.get("pageValuePresent"),
                    "pageUrl": page_url,
                    "sources": ["pages"],
                }
                entries.append(entry)
                by_domain[domain].append((nlabel, nsection, ftype, entry))
    return appended


def join_pending(data: dict, entries: list[dict], options_limit: int) -> int:
    """pending 是尚未映射的页面字段，补充进目录（source=pending），不重复计入。"""
    known = {
        (entry["domain"], normalize_key_text(entry["label"]), normalize_key_text(entry["section"]))
        for entry in entries
    }
    appended = 0
    for page_url, page in (data.get("pending") or {}).items():
        if not isinstance(page, dict):
            continue
        domain = domain_of_url(page_url)
        for field in page.get("fields") or []:
            if not isinstance(field, dict):
                continue
            label = normalize_label(field.get("label") or "")
            section = field.get("section") or ""
            key = (domain, normalize_key_text(label), normalize_key_text(section))
            if not label or key in known:
                continue
            known.add(key)
            appended += 1
            entries.append({
                "id": f"pending:{domain}:{appended}",
                "domain": domain,
                "label": label,
                "section": section,
                "moduleTitle": section,
                "type": field.get("type") or "",
                "required": bool(field.get("required")),
                "optionsCount": options_count(field.get("options")),
                "sensitive": False,
                "duplicateLabel": False,
                "slot": None,
                "scopePolicy": "",
                "status": field.get("status") or "",
                "seenCount": 0,
                "canonicalKey": field.get("canonicalKey"),
                "oldMethod": field.get("method"),
                "pageValuePresent": field.get("pageValuePresent"),
                "pageUrl": page_url,
                "sources": ["pending"],
            })
    return appended


def join_semantic_links(data: dict, entries: list[dict]) -> int:
    """semanticLinks: key = [label, section, type, options]（JSON 串）→ canonicalKey。"""
    links = data.get("semanticLinks") or {}
    if not isinstance(links, dict):
        return 0
    index: dict[tuple[str, str, str], str] = {}
    for raw_key, value in links.items():
        if not isinstance(value, dict):
            continue
        canonical = value.get("canonicalKey")
        if not canonical:
            continue
        try:
            parsed = json.loads(raw_key)
        except (TypeError, ValueError):
            continue
        if not isinstance(parsed, list) or len(parsed) < 3:
            continue
        label, section, ftype = (str(parsed[0]), str(parsed[1]), str(parsed[2]))
        index[(normalize_key_text(label), normalize_key_text(section), ftype)] = canonical

    merged = 0
    for entry in entries:
        if entry.get("canonicalKey"):
            continue
        key = (
            normalize_key_text(entry["label"]),
            normalize_key_text(entry["section"] or entry["moduleTitle"]),
            entry["type"],
        )
        canonical = index.get(key)
        if canonical:
            entry["canonicalKey"] = canonical
            entry["sources"].append("semanticLinks")
            merged += 1
    return merged


def extract_available_semantics(data: dict) -> dict:
    """用户资料中"有值"的语义 key 名单。只输出 key/来源/计数，绝不输出值。"""
    facts: list[dict] = []
    for key, item in (data.get("facts") or {}).items():
        if not isinstance(item, dict):
            continue
        facts.append({
            "key": key,
            "scopeType": item.get("scope_type"),
            "sourceDomain": item.get("source_domain"),
            "sourceLabel": normalize_label(item.get("source_label") or ""),
            "valueType": item.get("value_type"),
            "hasValue": bool(str(item.get("value") or "").strip()),
        })

    records: dict[str, dict] = {}
    for module, entries in (data.get("records") or {}).items():
        if not isinstance(entries, dict):
            continue
        field_stats: dict[str, dict] = {}
        for entry in entries.values():
            fields = entry.get("fields", {}) if isinstance(entry, dict) else {}
            if not isinstance(fields, dict):
                continue
            for field_key, field_value in fields.items():
                bucket = field_stats.setdefault(field_key, {"records": 0, "nonEmpty": 0})
                bucket["records"] += 1
                if isinstance(field_value, dict) and str(field_value.get("value") or "").strip():
                    bucket["nonEmpty"] += 1
        records[module] = field_stats

    definitions: list[dict] = []
    for key, item in (data.get("definitions") or {}).items():
        if not isinstance(item, dict):
            continue
        definitions.append({
            "key": key,
            "title": normalize_label(item.get("title") or ""),
            "section": item.get("section") or "",
            "valueType": item.get("value_type"),
            "aliases": item.get("aliases") or [],
            "hasValue": bool(str(item.get("value") or "").strip()),
        })

    resume_unmapped = sorted((data.get("resumeUnmapped") or {}).keys())
    preferences = sorted((data.get("preferences") or {}).keys())
    return {
        "facts": facts,
        "records": records,
        "definitions": definitions,
        "resumeUnmappedSections": resume_unmapped,
        "preferenceKeys": preferences,
    }


def summarize(entries: list[dict], profile_meta: dict) -> str:
    lines: list[str] = []
    lines.append("# 真实字段目录汇总（旧工具 profile.json，只含字段元数据）")
    lines.append("")
    lines.append(f"- 生成时间：{profile_meta['generatedAt']}")
    lines.append(f"- 来源：`{profile_meta['profilePath']}`（只读；SHA-256 `{profile_meta['profileSha256'][:16]}…`；更新时间 {profile_meta['updatedAt']}）")
    lines.append(f"- 字段条目总数：{len(entries)}（mappings {profile_meta['counts']['mappings']} 条 + pages 独有 {profile_meta['counts']['pagesOnly']} 条 + pending 独有 {profile_meta['counts']['pendingOnly']} 条）")
    lines.append("")
    lines.append("> 本文件不包含任何个人答案值，只有字段标签、结构、状态与计数。")
    lines.append("")

    by_domain: dict[str, list[dict]] = collections.defaultdict(list)
    for entry in entries:
        by_domain[entry["domain"]].append(entry)

    lines.append("## 按站点")
    lines.append("")
    lines.append("| 站点 | 字段数 | ready | unmatched | review | incompatible | missing | 有旧语义键 | 有选项 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    ordered = sorted(by_domain.items(), key=lambda item: (-len(item[1]), item[0]))
    for domain, items in ordered:
        status = collections.Counter(item["status"] for item in items)
        canonical = sum(1 for item in items if item.get("canonicalKey"))
        with_options = sum(1 for item in items if item.get("optionsCount"))
        lines.append(
            f"| {domain} | {len(items)} | {status.get('ready', 0)} | {status.get('unmatched', 0)} | "
            f"{status.get('review', 0)} | {status.get('incompatible', 0)} | {status.get('missing', 0)} | "
            f"{canonical} | {with_options} |"
        )
    lines.append("")

    lines.append("## 按状态")
    lines.append("")
    status = collections.Counter(entry["status"] for entry in entries)
    for name, count in status.most_common():
        lines.append(f"- {name}: {count}")
    lines.append("")

    lines.append("## 旧语义键分布（canonicalKey）")
    lines.append("")
    canonical = collections.Counter(entry["canonicalKey"] for entry in entries if entry.get("canonicalKey"))
    lines.append("| canonicalKey | 字段数 |")
    lines.append("| --- | --- |")
    for name, count in canonical.most_common():
        lines.append(f"| {name} | {count} |")
    lines.append("")

    lines.append("## 各站点字段标签（去重前 200 条/站点）")
    lines.append("")
    for domain, items in ordered:
        lines.append(f"### {domain}")
        lines.append("")
        for item in items[:200]:
            canonical_text = f" canon={item['canonicalKey']}" if item.get("canonicalKey") else ""
            lines.append(
                f"- `{item['label']}` | section={item['section'] or item['moduleTitle'] or '-'} | "
                f"type={item['type'] or '-'} | required={item['required']} | status={item['status'] or '-'} | "
                f"seen={item['seenCount']} | src={'+'.join(item['sources'])}{canonical_text}"
            )
        lines.append("")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract field catalog metadata from old CampusFormAgent profile.json (read-only).")
    parser.add_argument("--profile", default=str(DEFAULT_PROFILE), help="profile.json 路径（默认 %%LOCALAPPDATA%%\\CampusFormAgent\\profile.json）")
    parser.add_argument("--output-dir", default=str(SCRIPT_DIR), help="输出目录（默认本脚本目录）")
    parser.add_argument("--options-limit", type=int, default=DEFAULT_OPTIONS_LIMIT, help="保留参数兼容旧命令；现在只输出选项数量 optionsCount")
    args = parser.parse_args(argv)

    profile_path = Path(args.profile)
    if not profile_path.is_file():
        print(f"[catalog] profile.json 不存在：{profile_path}", file=sys.stderr)
        return 2

    raw = profile_path.read_bytes()
    data = json.loads(raw.decode("utf-8"))
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    entries = extract_mappings(data, args.options_limit)
    mappings_count = len(entries)
    pages_only = join_pages(data, entries, args.options_limit)
    pending_only = join_pending(data, entries, args.options_limit)
    sem_merged = join_semantic_links(data, entries)

    # 条目排序：站点、section、label，便于稳定 diff。
    entries.sort(key=lambda item: (item["domain"], item["section"] or item["moduleTitle"], item["label"], item["type"]))
    for index, entry in enumerate(entries):
        entry["order"] = index

    generated_at = datetime.now(timezone.utc).isoformat()
    profile_meta = {
        "generatedAt": generated_at,
        "profilePath": str(profile_path),
        "profileSha256": file_sha256(profile_path),
        "updatedAt": data.get("updatedAt"),
        "schemaVersion": data.get("schemaVersion"),
        "optionsPolicy": "只输出选项数量 optionsCount；原始选项文本可能包含用户已选答案，按 AGENTS.md 不输出。",
        "counts": {
            "mappings": mappings_count,
            "pagesOnly": pages_only,
            "pendingOnly": pending_only,
            "semanticLinksMerged": sem_merged,
            "entries": len(entries),
        },
    }

    catalog = {
        "meta": profile_meta,
        "targetDomains": TARGET_DOMAINS,
        "entries": entries,
    }
    catalog_path = output_dir / "field-catalog.json"
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    semantics = extract_available_semantics(data)
    semantics_meta = {
        "generatedAt": generated_at,
        "profilePath": str(profile_path),
        "profileSha256": profile_meta["profileSha256"],
        "note": "只有语义 key 与计数；不包含任何个人答案值。",
        **semantics,
    }
    semantics_path = output_dir / "available-semantics.json"
    semantics_path.write_text(json.dumps(semantics_meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    summary_path = output_dir / "catalog-summary.md"
    summary_path.write_text(summarize(entries, profile_meta), encoding="utf-8")

    print(f"[catalog] entries={len(entries)} mappings={mappings_count} pagesOnly={pages_only} pendingOnly={pending_only} semanticMerged={sem_merged}")
    print(f"[catalog] wrote {catalog_path}")
    print(f"[catalog] wrote {semantics_path}")
    print(f"[catalog] wrote {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
