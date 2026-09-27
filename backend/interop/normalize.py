"""Deterministic value normalization shared by the glossary, adapters and validation.

Nothing here guesses: every function is a pure, documented transformation so that
any comparison made by the validation engine can be reproduced by hand.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Any

_WS = re.compile(r"\s+")
_NAME_STRIP = re.compile(r"[^\w\s]", re.UNICODE)


def norm_term(value: Any) -> str | None:
    """Glossary lookup key: NFKC, casefold, trim, collapse internal whitespace."""
    if value is None:
        return None
    text = _WS.sub(" ", unicodedata.normalize("NFKC", str(value))).strip().casefold()
    return text or None


def norm_name(value: Any) -> str | None:
    """Person/party-name comparison key: norm_term plus punctuation removal."""
    text = norm_term(value)
    if text is None:
        return None
    text = _WS.sub(" ", _NAME_STRIP.sub(" ", text)).strip()
    return text or None


def norm_code(value: Any) -> str | None:
    """Identifier comparison key (survey numbers, khata numbers): trimmed string, case-insensitive."""
    if value is None:
        return None
    text = str(value).strip().upper()
    return text or None


def to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_date(value: Any) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def has_non_latin_letters(value: Any) -> bool:
    """True if the text contains alphabetic characters outside the Latin script."""
    if not isinstance(value, str):
        return False
    for ch in value:
        if ch.isalpha() and "LATIN" not in unicodedata.name(ch, ""):
            return True
    return False


def normalize_ulpin(raw: str) -> str:
    """Strip spaces and hyphens a caller may use to group digits. Does not validate."""
    return re.sub(r"[\s-]", "", raw or "")


def is_valid_ulpin(value: str) -> bool:
    return len(value) == 14 and value.isdigit()
