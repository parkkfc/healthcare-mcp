# -*- coding: utf-8 -*-
"""Rebuild src/tools/register-all.ts from domain modules.

Edit identity-home / profile / diet / workout / charts / training-docs, then run:
  python scripts/rebuild-register-all.py

AppType needs a single registerTool chain (TS drops TTools across function boundaries).
"""
from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "src" / "tools"
ORDER = [
    "identity-home.ts",
    "profile.ts",
    "diet.ts",
    "workout.ts",
    "charts.ts",
    "training-docs.ts",
]


def extract_chain_body(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    m = re.search(
        r"export function register\w+(?:<[^>]+>)?\([^)]*\)[^{]*\{\s*return server\n",
        text,
    )
    if not m:
        raise SystemExit(f"no register fn in {path}")
    body = text[m.end() :].rstrip()
    if body.endswith("}"):
        body = body[:-1].rstrip()
    return body


def parse_imports(text: str) -> list[tuple[str, set[str] | None, str]]:
    results: list[tuple[str, set[str] | None, str]] = []
    lines = text.splitlines(keepends=True)
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.startswith("import "):
            i += 1
            continue
        block = line
        if " from " not in line and not line.rstrip().endswith(";"):
            i += 1
            while i < len(lines):
                block += lines[i]
                if " from " in lines[i] or lines[i].rstrip().endswith(";"):
                    break
                i += 1
        i += 1
        block_s = block.strip().rstrip(";")
        if re.match(r'import\s+["\']', block_s):
            mod = re.search(r'["\']([^"\']+)["\']', block_s)
            if mod:
                results.append(("side", None, mod.group(1)))
            continue
        mod_m = re.search(r'from\s+["\']([^"\']+)["\']', block_s)
        if not mod_m:
            continue
        mod = mod_m.group(1)
        if mod.endswith("/helpers.js") or mod == "./helpers.js":
            names: set[str] = set()
            hm = re.search(r"\{([^}]+)\}", block_s, re.S)
            if hm:
                for part in hm.group(1).split(","):
                    part = part.strip()
                    if part:
                        names.add(part)
            results.append(("helpers", names, mod))
            continue
        if "McpServer" in block_s and "skybridge" in mod:
            continue
        ns = re.match(r"import\s+\*\s+as\s+(\w+)", block_s)
        if ns:
            results.append(("ns", {ns.group(1)}, mod))
            continue
        names = set()
        brace = re.search(r"\{([^}]+)\}", block_s, re.S)
        if brace:
            for part in brace.group(1).split(","):
                part = part.strip()
                if part:
                    names.add(part)
        if re.match(r"import\s+(?:type\s+)?(\w+)\s+from", block_s) and "{" not in block_s:
            dm = re.match(r"import\s+(?:type\s+)?(\w+)\s+from", block_s)
            if dm:
                results.append(("default", {dm.group(1)}, mod))
            continue
        type_only = block_s.startswith("import type ")
        results.append(("named_type" if type_only else "named", names, mod))
    return results


named_by_mod: dict[str, set[str]] = defaultdict(set)
type_by_mod: dict[str, set[str]] = defaultdict(set)
defaults: dict[str, str] = {}
namespaces: dict[str, str] = {}
helpers: set[str] = set()
sides: list[str] = []

for name in ORDER:
    text = (TOOLS / name).read_text(encoding="utf-8")
    for kind, names, mod in parse_imports(text):
        if kind == "helpers" and names:
            helpers |= names
        elif kind == "named" and names:
            named_by_mod[mod] |= names
        elif kind == "named_type" and names:
            type_by_mod[mod] |= names
        elif kind == "default" and names:
            defaults[mod] = next(iter(names))
        elif kind == "ns" and names:
            namespaces[mod] = next(iter(names))
        elif kind == "side" and mod not in sides:
            sides.append(mod)

sky_vals: set[str] = set()
for name in ORDER:
    t = (TOOLS / name).read_text(encoding="utf-8")
    if re.search(r"\bFileRef\b", t):
        sky_vals.add("FileRef")
    if re.search(r"\btext\b", t):
        sky_vals.add("text")

import_lines = ['import type { McpServer } from "skybridge/server";']
if sky_vals:
    import_lines.append(
        "import { " + ", ".join(sorted(sky_vals)) + ' } from "skybridge/server";'
    )
import_lines.append('import { z } from "zod";')
named_by_mod.pop("zod", None)
named_by_mod.pop("skybridge/server", None)
type_by_mod.pop("skybridge/server", None)

for mod in sides:
    import_lines.append(f'import "{mod}";')
for mod, ident in sorted(defaults.items()):
    import_lines.append(f'import {ident} from "{mod}";')
for mod, ident in sorted(namespaces.items()):
    import_lines.append(f'import * as {ident} from "{mod}";')

for mod in sorted(set(named_by_mod) | set(type_by_mod)):
    named = named_by_mod.get(mod, set())
    typed = type_by_mod.get(mod, set())
    value_specs, type_specs = [], []
    for n in sorted(named | typed):
        if n.startswith("type "):
            type_specs.append(n)
        elif n in typed and n not in named:
            type_specs.append(f"type {n}")
        else:
            value_specs.append(n)
    specs = value_specs + type_specs
    if not specs:
        continue
    if len(specs) <= 3:
        import_lines.append(f'import {{ {", ".join(specs)} }} from "{mod}";')
    else:
        import_lines.append(
            "import {\n  " + ",\n  ".join(specs) + f'\n}} from "{mod}";'
        )

if helpers:
    import_lines.append(
        "import {\n  " + ",\n  ".join(sorted(helpers)) + '\n} from "./helpers.js";'
    )

chains = [
    f"  // --- {name} ---\n" + extract_chain_body(TOOLS / name) for name in ORDER
]

out = (
    "\n".join(import_lines)
    + "\n\n"
    + "/** Single-function registration so AppType accumulates every tool. */\n"
    + "export function registerAllTools(server: McpServer) {\n"
    + "  return server\n"
    + "\n".join(chains)
    + "\n}\n"
)

(TOOLS / "register-all.ts").write_text(out, encoding="utf-8")
(TOOLS / "index.ts").write_text(
    'export { registerAllTools } from "./register-all.js";\n'
    'export { registerIdentityHome } from "./identity-home.js";\n'
    'export { registerProfile } from "./profile.js";\n'
    'export { registerDiet } from "./diet.js";\n'
    'export { registerWorkout } from "./workout.js";\n'
    'export { registerCharts } from "./charts.js";\n'
    'export { registerTrainingDocs } from "./training-docs.js";\n',
    encoding="utf-8",
)
print(f"wrote {TOOLS / 'register-all.ts'} ({len(out)} chars)")
