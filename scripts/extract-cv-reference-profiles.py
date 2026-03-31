#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path
from pypdf import PdfReader

REFERENCE_FILES = {
    'financial_crime_ops': Path('/Users/adeomosanya/Downloads/AdeOmosanya_CV_myPOS.pdf'),
    'product_delivery': Path('/Users/adeomosanya/Downloads/AdeOmosanya_CV_MB.pdf'),
    'clm_programme': Path('/Users/adeomosanya/Downloads/AdeOmosanya_CV_CLM_PD.pdf'),
    'fenergo_delivery': Path('/Users/adeomosanya/Downloads/Ade_Omosanya_CV_Fenergo__SPM.pdf'),
    'institutional_clm': Path('/Users/adeomosanya/Downloads/AdeOmosanya_CV_RBC__CLM.pdf'),
}

OUTPUT_PATH = Path('scripts/cv-reference-profiles.generated.json')


def collapse_whitespace(value: str) -> str:
    return re.sub(r'\s+', ' ', value).strip()


def split_bullets(text: str) -> list[str]:
    parts = [collapse_whitespace(item) for item in re.split(r'\s+•\s+', text) if collapse_whitespace(item)]
    return [item for item in parts if len(item) > 20]


def extract_sections(raw_text: str) -> dict[str, object]:
    compact = collapse_whitespace(raw_text.replace('KEY ACHIEVEMENTS', '\nKEY ACHIEVEMENTS\n').replace('PROFESSIONAL EXPERIENCE', '\nPROFESSIONAL EXPERIENCE\n'))
    compact = compact.replace('_______________________________________________________________________', ' ')

    summary = ''
    achievements: list[str] = []

    summary_match = re.search(r'Portfolio:.*?(?=KEY ACHIEVEMENTS)', compact, flags=re.IGNORECASE)
    if summary_match:
        summary_source = summary_match.group(0)
        if 'Portfolio:' in summary_source:
            summary = collapse_whitespace(summary_source.split('Portfolio:', 1)[-1])
            summary = re.sub(r'^.*?\|\s*SMCR\s*Platform\s*', '', summary, count=1)

    achievements_match = re.search(r'KEY ACHIEVEMENTS\s*(.*?)(?=PROFESSIONAL EXPERIENCE)', compact, flags=re.IGNORECASE)
    if achievements_match:
        achievements = split_bullets('• ' + achievements_match.group(1))[:6]

    return {
        'summary': summary,
        'achievements': achievements,
    }


def main() -> None:
    data: dict[str, object] = {}
    for profile_id, path in REFERENCE_FILES.items():
        reader = PdfReader(str(path))
        text = '\n'.join(page.extract_text() or '' for page in reader.pages)
        sections = extract_sections(text)
        data[profile_id] = {
            'source_pdf_path': str(path),
            'pages': len(reader.pages),
            **sections,
        }

    OUTPUT_PATH.write_text(json.dumps(data, indent=2), encoding='utf-8')
    print(json.dumps({'written': str(OUTPUT_PATH), 'profiles': list(data.keys())}, indent=2))


if __name__ == '__main__':
    main()
