from __future__ import annotations

import json
import re
from typing import List

from .config import dedupe_keep_order
from .models import JobRecord

TITLE_STRIP_TOKENS = {
    "senior",
    "sr",
    "lead",
    "principal",
    "head",
    "junior",
    "jr",
}


def normalise_company(name: str) -> str:
    cleaned = re.sub(r"[^\w\s]", " ", (name or "").lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def normalise_title(title: str) -> str:
    cleaned = re.sub(r"[^\w\s]", " ", (title or "").lower())
    tokens = [tok for tok in cleaned.split() if tok and tok not in TITLE_STRIP_TOKENS]
    return " ".join(tokens)


def record_richness(record: JobRecord) -> float:
    score = 0.0
    score += 1.0 if record.notes else 0.0
    score += 1.0 if record.posted else 0.0
    score += 1.0 if record.location else 0.0
    score += 1.0 if record.link else 0.0
    score += 1.0 if record.applicant_count else 0.0
    score += min(len(record.notes or ""), 200) / 200.0
    return score


def merge_records(primary: JobRecord, secondary: JobRecord) -> JobRecord:
    if secondary.link and secondary.link != primary.link:
        primary.alternate_links.append({"source": secondary.source, "link": secondary.link})
    if secondary.notes and not primary.notes:
        primary.notes = secondary.notes
    if secondary.posted and not primary.posted:
        primary.posted = secondary.posted
    if secondary.location and not primary.location:
        primary.location = secondary.location
    if secondary.applicant_count and not primary.applicant_count:
        primary.applicant_count = secondary.applicant_count
    return primary


def dedupe_records(records: List[JobRecord]) -> List[JobRecord]:
    deduped: List[JobRecord] = []
    for record in records:
        matched_index = None
        record_company = normalise_company(record.company)
        record_title = normalise_title(record.role)
        for idx, existing in enumerate(deduped):
            existing_company = normalise_company(existing.company)
            if existing_company != record_company:
                continue
            existing_title = normalise_title(existing.role)
            similarity = 0.0
            if existing_title and record_title:
                similarity = (
                    1.0
                    - (
                        len(set(record_title.split()) ^ set(existing_title.split()))
                        / max(1, len(set(record_title.split()) | set(existing_title.split())))
                    )
                )
            if similarity >= 0.85:
                matched_index = idx
                break

        if matched_index is None:
            deduped.append(record)
            continue

        existing = deduped[matched_index]
        primary, secondary = existing, record
        if record_richness(record) > record_richness(existing):
            primary, secondary = record, existing
        elif record_richness(record) == record_richness(existing) and record.fit_score > existing.fit_score:
            primary, secondary = record, existing

        merged = merge_records(primary, secondary)
        if existing is not merged:
            merged.alternate_links.extend(existing.alternate_links)
        merged.alternate_links = dedupe_keep_order(
            [json.dumps(link, sort_keys=True) for link in merged.alternate_links]
        )
        merged.alternate_links = [json.loads(item) for item in merged.alternate_links]

        deduped[matched_index] = merged

    return deduped
