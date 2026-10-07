"""Renders the canned JSON responses under fake_data/<service>/.

A leaf string that is exactly ``"{{name}}"`` becomes the typed value; ``{{name}}`` inside a
longer string is interpolated. Templates are re-read on every call, so edits apply immediately.
"""

import re
from typing import Any

from .jsonstore import read_json
from .paths import data_dir

_FULL = re.compile(r"^\{\{(\w+)\}\}$")
_PART = re.compile(r"\{\{(\w+)\}\}")


def _fill(node: Any, values: dict[str, Any]) -> Any:
    if isinstance(node, dict):
        return {k: _fill(v, values) for k, v in node.items()}
    if isinstance(node, list):
        return [_fill(v, values) for v in node]
    if isinstance(node, str):
        if m := _FULL.match(node):
            return values.get(m.group(1))
        return _PART.sub(lambda m: str(values.get(m.group(1), "")), node)
    return node


def render(service: str, template_name: str, /, **values: Any) -> Any:
    template = read_json(data_dir() / service / f"{template_name}.json")
    if template is None:
        raise FileNotFoundError(f"Missing template fake_data/{service}/{template_name}.json")
    return _fill(template, values)
