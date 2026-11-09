"""安全校验：确认 diagnostics/coverage 输出中不含用户真实个人答案值。

做法：从 profile.json 中收集所有"值字段"（facts.value、records.*.fields.*.value、
resumeUnmapped 文本、resumeSource 路径）作为敏感串，再扫描本目录生成物。
只输出命中计数与来源类别，不输出任何值内容（AGENTS.md）。

用法（仓库根）：
    python diagnostics/coverage/verify_no_personal_values.py
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
PROFILE = Path(
    os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")),
    "CampusFormAgent",
    "profile.json",
)

# 生成物（JSON/Markdown）：只扫描这些文件。
OUTPUT_GLOBS = ["field-catalog.json", "available-semantics.json", "catalog-summary.md"]
OUTPUT_GLOB_PATTERNS = ["coverage-*.json", "coverage-*.md"]


def collect_sensitive_values(node, path: str, out: list[tuple[str, str]]) -> None:
    """收集所有敏感值（只留在内存里比对，不打印）。"""
    if isinstance(node, dict):
        for key, value in node.items():
            child_path = f"{path}.{key}" if path else key
            if key in ("value", "content", "answer", "currentValue") and isinstance(value, str) and value.strip():
                out.append((child_path, value))
            else:
                collect_sensitive_values(value, child_path, out)
    elif isinstance(node, list):
        for index, value in enumerate(node):
            collect_sensitive_values(value, f"{path}[{index}]", out)


def is_high_entropy(value: str) -> bool:
    """高熵/可直接识别个人的值：长文本、邮箱、7 位以上数字串、日期串。"""
    text = value.strip()
    if len(text) >= 6:
        return True
    if "@" in text or re.search(r"\d{7,}", text):
        return True
    if re.search(r"\d{4}[-/年]\d{1,2}", text):
        return True
    return False


def main() -> int:
    if not PROFILE.is_file():
        print(f"[verify] profile.json 不存在，跳过：{PROFILE}", file=sys.stderr)
        return 2
    data = json.loads(PROFILE.read_text(encoding="utf-8"))

    sensitive: list[tuple[str, str]] = []
    collect_sensitive_values(data.get("facts") or {}, "facts", sensitive)
    collect_sensitive_values(data.get("records") or {}, "records", sensitive)
    collect_sensitive_values(data.get("resumeUnmapped") or {}, "resumeUnmapped", sensitive)
    collect_sensitive_values(data.get("preferences") or {}, "preferences", sensitive)
    resume_source = data.get("resumeSource") or {}
    if isinstance(resume_source.get("path"), str):
        sensitive.append(("resumeSource.path", resume_source["path"]))
    # 去掉过短的枚举值（男/女/未婚等），避免与站点选项文本重叠造成假阳性。
    sensitive = [(label, value.strip()) for label, value in sensitive if len(value.strip()) >= 2]

    outputs: list[Path] = []
    for name in OUTPUT_GLOBS:
        outputs.extend(SCRIPT_DIR.glob(name))
    for pattern in OUTPUT_GLOB_PATTERNS:
        outputs.extend(SCRIPT_DIR.glob(pattern))
    outputs = sorted({path for path in outputs if path.is_file()})

    high_hits: list[tuple[str, str, str]] = []  # (来源类别, 输出文件, 敏感路径)
    low_hits: list[tuple[str, str, str]] = []
    for output in outputs:
        try:
            text = output.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            text = output.read_text(encoding="utf-8", errors="ignore")
        for sensitive_path, value in sensitive:
            if value in text:
                high = is_high_entropy(value)
                bucket = high_hits if high else low_hits
                category = sensitive_path.split("[")[0].split(".")[0]
                bucket.append((category, output.name, sensitive_path))

    print(f"[verify] 扫描输出文件 {len(outputs)} 个；敏感值样本 {len(sensitive)} 条（-> 内存比对，不打印内容）")
    print(f"[verify] 高熵敏感值命中：{len(high_hits)} 条（必须为 0）")
    for category, output_name, sensitive_path in high_hits[:20]:
        print(f"  !! {output_name} 命中 {category} 类值（来源路径前缀 {sensitive_path.split('.')[0]}，内容已省略）")
    print(f"[verify] 低熵（枚举/短词）重叠：{len(low_hits)} 条（可能只是站点选项文本，人工判断）")
    categories: dict[str, int] = {}
    for category, _output, _path in low_hits:
        categories[category] = categories.get(category, 0) + 1
    for category, count in sorted(categories.items()):
        print(f"  - {category}: {count}")
    if high_hits:
        print("[verify] 失败：输出中疑似包含个人答案值。", file=sys.stderr)
        return 1
    print("[verify] 通过：生成物中未发现高熵个人答案值。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
