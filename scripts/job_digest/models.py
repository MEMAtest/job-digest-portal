from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class JobRecord:
    role: str
    company: str
    location: str
    link: str
    posted: str
    source: str
    fit_score: int
    preference_match: str
    why_fit: str
    cv_gap: str
    notes: str
    posted_raw: str = ""
    posted_date: str = ""
    role_summary: str = ""
    tailored_summary: str = ""
    tailored_cv_bullets: List[str] = field(default_factory=list)
    key_requirements: List[str] = field(default_factory=list)
    match_notes: str = ""
    company_insights: str = ""
    cover_letter: str = ""
    key_talking_points: List[str] = field(default_factory=list)
    star_stories: List[str] = field(default_factory=list)
    quick_pitch: str = ""
    interview_focus: str = ""
    prep_questions: List[str] = field(default_factory=list)
    prep_answers: List[str] = field(default_factory=list)
    scorecard: List[str] = field(default_factory=list)
    apply_tips: str = ""
    tailored_cv_sections: dict = field(default_factory=dict)
    applicant_count: str = ""
    job_status: str = ""
    alternate_links: List[Dict[str, str]] = field(default_factory=list)
