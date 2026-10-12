#!/usr/bin/env python3
"""Atualização autônoma do Observatório público.

Sem SMTP, credenciais privadas ou e-mails. Publica alertas apenas no site.
Primeira consulta estabelece referência; mudanças subsequentes são informativas.
"""
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from bs4 import BeautifulSoup
from edition_identity import parse_edition

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
NOW = datetime.now(timezone.utc).isoformat(timespec="seconds")
SOURCES = [
    ("Finep", "https://www.finep.gov.br/chamadas-publicas"),
    ("FAPEPI", "https://www.fapepi.pi.gov.br/editais/"),
]
ALLOWED = {
    "www.finep.gov.br", "finep.gov.br", "faleconosco.finep.gov.br",
    "www.fapepi.pi.gov.br", "fapepi.pi.gov.br",
}
KEYWORDS = ("edital", "chamada", "centelha", "tecnova", "subven", "financ",
            "inova", "agricultura", "economia", "fomento", "pesquisa",
            "material", "retific", "errata", "prorrog")
DOC_WORDS = ("retific", "errata", "cronograma", "adendo", "prorrog")
TIMEOUT = 17
session = requests.Session()
session.headers.update({"User-Agent": "ObservatorioDeFomento/1.1 (GitHub Pages; public institutional monitoring)"})


def load(name, default):
    try:
        with (DATA / name).open(encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError, TypeError):
        return default


def save(name, obj):
    path = DATA / name
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def norm(value):
    result = unicodedata.normalize("NFKD", str(value or "").lower())
    return "".join(c for c in result if not unicodedata.combining(c))


def allowed(url):
    try:
        p = urlsplit(url)
        return (p.scheme == "https" and p.hostname in ALLOWED and
                not p.username and not p.password and len(url) <= 1500)
    except (TypeError, ValueError):
        return False


def download(url, *, max_bytes=5_000_000):
    if not allowed(url):
        raise ValueError("Fonte não autorizada")
    result = session.get(url, timeout=TIMEOUT, allow_redirects=True)
    result.raise_for_status()
    if not allowed(result.url) or len(result.content) > max_bytes:
        raise ValueError("Resposta fora dos limites")
    return result


def fingerprint(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_score(text):
    normalized = norm(text)
    terms = {
        "Materiais e cerâmicas": ("ceramica", "nanomateriais", "materiais avancados", "adsorvente"),
        "Água e meio ambiente": ("tratamento de agua", "reuso", "saneamento", "efluente"),
        "Agro e fertilizantes": ("agricultura", "fertilizante", "agroindustr", "bioinsumo"),
        "Startups e inovação": ("tecnova", "centelha", "subvencao", "startup", "inovacao"),
        "Pesquisa institucional": ("ict", "universidade", "pesquisa", "fomento"),
    }
    themes = [theme for theme, words in terms.items() if any(word in normalized for word in words)]
    value = min(100, len(themes) * 20)
    return {
        "score": value,
        "level": "Alta" if value >= 65 else "Média" if value >= 35 else "Baixa",
        "themes": themes,
        "route": "Proponente e requisitos a confirmar no edital oficial",
    }


def event_id(url, kind, signature):
    return hashlib.sha256(f"{url}|{kind}|{signature}".encode("utf-8")).hexdigest()[:20]


def detect_event(url, title, org, kind, signature, *, watched=False,
                 program=None, edition=None, parent_url=None, relevance=None):
    result = {
        "key": event_id(url, kind, signature),
        "id": event_id(url, kind, signature),
        "kind": kind,
        "title": title[:180],
        "org": org,
        "url": url,
        "detected_at": NOW,
        "watched": bool(watched),
        "requires_review": True,
        "relevance": relevance or compute_score(title),
    }
    if program:
        result["program"] = program
    if edition:
        result["edition"] = edition
    if parent_url:
        result["parent_url"] = parent_url
    return result


def discover(roots, max_targets=55):
    result = {}
    errors = []
    for org, root in roots:
        try:
            soup = BeautifulSoup(download(root).text, "html.parser")
            for a in soup.select("a[href]"):
                raw = a.get("href", "")
                url = urljoin(root, raw).split("#", 1)[0]
                label = a.get_text(" ", strip=True)[:180]
                if not allowed(url) or not label:
                    continue
                if not any(k in norm(label + " " + url) for k in KEYWORDS):
                    continue
                path = urlsplit(url).path
                valid_path = (
                    (org == "Finep" and (
                        "/chamadas-publicas/chamadapublica/" in path or
                        "/e/chamada-publica/" in path
                    )) or
                    (org == "FAPEPI" and "/edital/" in path)
                )
                if valid_path and url not in result and len(result) < max_targets:
                    result[url] = {"title": label, "org": org, "source": "descoberto"}
        except (requests.RequestException, ValueError) as exc:
            errors.append({"org": org, "message": type(exc).__name__})
    return result, errors


def main():
    catalog = load("catalog_sources.json", {"sources": []}).get("sources", [])
    previous = load("public_monitor_state.json", {"pages": {}, "events": [], "known_editions": {}})
    pages = previous.get("pages", {})
    historical = list(previous.get("events", []))
    known_ids = {event.get("key") for event in historical}
    first_scan = not bool(previous.get("last_scan"))
    seen = set()
    watched = load("public_favorite_snapshot.json", {"items": []})
    # Fonte autoritativa dos favoritos: leitura anônima do Supabase com RLS.
    watch_map = {}
    supabase_ok = False
    api_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    api_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    if api_url and api_key:
        try:
            query = (api_url + "/rest/v1/editais_favoritos?"
                     "select=chave,url,titulo,ativo&ativo=eq.true&limit=500")
            response = requests.get(query,
                headers={"apikey": api_key, "Accept": "application/json"},
                timeout=20)
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list):
                raise ValueError("Formato de favoritos inesperado")
            supabase_ok = True
            for row in rows:
                if allowed(row.get("url")):
                    watch_map.setdefault(row["url"], []).append(row)
        except (requests.RequestException, ValueError, TypeError):
            print("Supabase indisponível: preservando apenas a lista da coleta anterior.")
    if not supabase_ok:
        for row in watched.get("items", []):
            if allowed(row.get("url")):
                watch_map.setdefault(row["url"], []).append(row)
    elif supabase_ok:
        save("public_favorite_snapshot.json", {
            "updated_at": NOW,
            "items": [row for group in watch_map.values() for row in group],
        })

    known_versions = dict(previous.get("known_editions", {}))
    for row in catalog:
        info = parse_edition(row.get("title", ""), row.get("url", ""))
        if info:
            known_versions[info["program"]] = max(
                known_versions.get(info["program"], 0), info["edition"]
            )
    followed_programs = {
        info["program"]
        for group in watch_map.values() for row in group
        if (info := parse_edition(row.get("titulo", ""), row.get("url", "")))
    }

    targets = {}
    for row in catalog:
        url = row.get("url")
        if allowed(url):
            org = "FAPEPI" if "fapepi.pi.gov.br" in url else "Finep"
            targets.setdefault(url, {"title": row["title"], "org": org,
                                     "source": "catálogo"})
    for url, group in watch_map.items():
        org = "FAPEPI" if "fapepi.pi.gov.br" in url else "Finep"
        targets.setdefault(url, {"title": group[0].get("titulo", "Edital acompanhado"),
                                 "org": org, "source": "favorito"})

    found, errors = discover(SOURCES)
    for url, info in found.items():
        targets.setdefault(url, info)

    new_events = []
    items = []
    for url, entry in list(targets.items())[:75]:
        title = str(entry["title"])[:180]
        org = entry["org"]
        try:
            response = download(url)
            soup = BeautifulSoup(response.text, "html.parser")
            official_title = soup.title.get_text(" ", strip=True) if soup.title else title
            # Focar o conteúdo substantivo e não menus/rodapés que variam.
            for el in soup.select("script,style,noscript,nav,footer,header,form"):
                el.decompose()
            area = soup.select_one("main") or soup.select_one("article") or soup.body or soup
            body = re.sub(r"\s+", " ", area.get_text(" ", strip=True))[:45000]
            signature = fingerprint(body)
            relevance = compute_score(title + " " + official_title + " " + body[:11000])
            old = pages.get(url, {})
            edition = parse_edition(title, url) or parse_edition(official_title, url)
            newly_announced = False
            if edition:
                old_version = old.get("edition")
                newly_announced = (
                    edition["edition"] > known_versions.get(edition["program"], 0)
                    or bool(old_version and edition["edition"] > old_version)
                )
            watched_flag = url in watch_map
            items.append({
                "url": url, "title": title, "org": org,
                "source": entry["source"], "last_seen": NOW,
                "relevance": relevance,
                "program": edition["program"] if edition else None,
                "edition": edition["edition"] if edition else None,
                "is_new_edition": newly_announced,
            })
            signature_old = old.get("fingerprint")
            kind = None
            if not first_scan and signature_old and signature_old != signature:
                kind = "Possível alteração na página oficial"
            elif not first_scan and not signature_old and newly_announced:
                kind = "Nova edição de programa identificada"
            elif not first_scan and not signature_old and entry["source"] == "descoberto":
                kind = "Nova chamada identificada"

            # Evita avisos excessivos: mudanças de páginas gerais só entram
            # no feed quando o edital está nos favoritos. Novas chamadas só
            # entram se houver aderência preliminar; novas edições têm prioridade.
            publish_event = bool(kind and (
                newly_announced or watched_flag or
                (kind == "Nova chamada identificada" and relevance["score"] >= 35)
            ))
            if publish_event:
                evt = detect_event(
                    url, title, org, kind, signature,
                    watched=watched_flag,
                    program=edition["program"] if edition else None,
                    edition=edition["edition"] if edition else None,
                    relevance=relevance,
                )
                if evt["key"] not in known_ids:
                    new_events.append(evt)
                    known_ids.add(evt["key"])
            # Detectar inclusão/troca de links de anexos associados à retificação.
            docs = {}
            for link in area.select("a[href]"):
                href = urljoin(url, link.get("href", "")).split("#", 1)[0]
                label = link.get_text(" ", strip=True)[:160]
                if (allowed(href) and
                    any(k in norm(label + " " + href) for k in DOC_WORDS)
                    and (".pdf" in href.lower() or "anexo" in norm(label))):
                    docs[href] = label
            old_docs = old.get("docs", {})
            for href, label in list(docs.items())[:12]:
                if old and href not in old_docs and not first_scan and watched_flag:
                    evt = detect_event(
                        href, f"{title} · {label}", org,
                        "Novo anexo ou documento de retificação identificado",
                        href, watched=watched_flag, parent_url=url,
                        relevance=relevance,
                    )
                    if evt["key"] not in known_ids:
                        new_events.append(evt)
                        known_ids.add(evt["key"])
            pages[url] = {
                "fingerprint": signature, "title": official_title[:180],
                "edition": edition["edition"] if edition else None,
                "program": edition["program"] if edition else None,
                "docs": docs,
                "last_seen": NOW,
            }
            if edition and newly_announced:
                known_versions[edition["program"]] = max(
                    known_versions.get(edition["program"], 0), edition["edition"]
                )
            seen.add(url)
        except (requests.RequestException, ValueError) as exc:
            errors.append({"org": org, "message": type(exc).__name__, "url": url})
        time.sleep(0.15)

    new_events = sorted(new_events, key=lambda e: e["detected_at"], reverse=True)
    all_events = (new_events + historical)[:120]
    successes = len(items)
    status = "ok" if successes and not errors else "parcial" if successes else "falha"
    # If all requests fail, do not overwrite the previous timeline or baseline.
    if successes:
        save("public_monitor_state.json", {
            "last_scan": NOW,
            "pages": pages,
            "events": all_events,
            "known_editions": known_versions,
        })
        save("notifications.json", {
            "generated_at": NOW, "status": status,
            "total": len(all_events), "events": all_events,
            "notes": [
                "Avisos informativos, não equivalem a retificações confirmadas.",
                "Notificações exibidas somente no site; não há envio de e-mails.",
            ],
        })
        save("monitor.json", {
            "generated_at": NOW, "last_success_at": NOW, "status": status,
            "checked_pages": successes, "discovered": sum(
                x["source"] == "descoberto" for x in items),
            "watched_count": len(watch_map),
            "items": sorted(items, key=lambda x: -x["relevance"]["score"])[:120],
            "events": all_events[:80],
            "failures": [],  # Não expor detalhes internos da coleta.
            "notes": [
                "Consultar a fonte oficial antes de agir.",
                "Avisos internos na central do Observatório; e-mails desativados.",
            ],
        })
    print(json.dumps({
        "status": status,
        "pages_checked": successes,
        "new_notifications": len(new_events),
        "favorites_sources": len(watch_map),
        "errors": len(errors),
        "first_scan": first_scan,
    }))
    return 0 if successes else 1


if __name__ == "__main__":
    sys.exit(main())
