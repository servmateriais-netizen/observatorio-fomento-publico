"""Identifica versões explícitas de programas em títulos/URLs oficiais.

Não presume que a nova edição está aberta: retorna somente versão anunciada.
O mesmo programa pode ter edições 3 e 4 sem apagar o histórico da anterior.
"""
import re
import unicodedata
from urllib.parse import unquote

ROMAN = {
    "i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5,
    "vi": 6, "vii": 7, "viii": 8, "ix": 9, "x": 10,
}


def normalized(text):
    decomposed = unicodedata.normalize("NFKD", str(text or "").lower())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def parse_edition(text, url=""):
    try:
        readable_url = unquote(str(url or ""))
    except (ValueError, TypeError):
        readable_url = str(url or "")
    merged = normalized(text) + " " + normalized(readable_url)
    pattern = (
        r"(?:^|[^a-z0-9])(centelha|tecnova)[\s\-_/.:]*"
        r"(?:n[º°.]?\s*)?"
        r"([1-9][0-9]{0,2}|viii|vii|vi|iv|iii|ii|ix|v|i|x)"
        r"(?=$|[^a-z0-9])"
    )
    match = re.search(pattern, merged, re.I)
    if match:
        number = match.group(2).lower()
        edition = int(number) if number.isdigit() else ROMAN.get(number)
        if edition:
            return {"program": match.group(1).lower(), "edition": edition}
    generic = re.search(
        r"\bprograma\s+([a-z][a-z0-9 \-]{2,42}?)"
        r"\s*(?:[,:\-]\s*|\s+)([1-9][0-9]{0,2})\s*(?:a|o|ª|º)?\s*edicao\b",
        merged,
    )
    if generic:
        program = re.sub(r"[^a-z0-9]+", "-", generic.group(1)).strip("-")[:60]
        return {"program": program, "edition": int(generic.group(2))}
    return None


def future_edition(info, known_max):
    return bool(info and info["edition"] > known_max.get(info["program"], 0))
