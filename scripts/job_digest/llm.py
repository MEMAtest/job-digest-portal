from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from typing import Dict, List, Optional

from . import config
from .models import JobRecord

try:
    import google.generativeai as genai
except Exception:  # noqa: BLE001
    genai = None

try:
    import openai as openai_lib
except Exception:  # noqa: BLE001
    openai_lib = None

try:
    from groq import Groq as GroqClient
except ImportError:
    GroqClient = None


def parse_gemini_payload(text: str) -> Optional[Dict[str, object]]:
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _sleep_for_rpm() -> None:
    if config.GROQ_RATE_LIMIT_RPM <= 0:
        return
    delay = 60 / max(1, config.GROQ_RATE_LIMIT_RPM)
    time.sleep(delay)


def _extract_retry_after(error: Exception) -> Optional[int]:
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", None) if response else None
    if headers:
        retry_after = headers.get("retry-after") or headers.get("Retry-After")
        if retry_after:
            try:
                return int(float(retry_after))
            except ValueError:
                return None
    return None


def generate_gemini_text(prompt: str) -> Optional[str]:
    if not config.GEMINI_API_KEY or genai is None:
        return None
    try:
        genai.configure(api_key=config.GEMINI_API_KEY)
    except Exception:
        return None

    model_names = [config.GEMINI_MODEL] + [
        m for m in config.GEMINI_FALLBACK_MODELS if m != config.GEMINI_MODEL
    ]
    for name in model_names:
        try:
            model = genai.GenerativeModel(name)
            response = model.generate_content(prompt)
            return getattr(response, "text", "") or ""
        except Exception:
            continue
    return None


def generate_gemini_text_with_timeout(prompt: str, timeout_seconds: int) -> Optional[str]:
    if timeout_seconds <= 0:
        return generate_gemini_text(prompt)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(generate_gemini_text, prompt)
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeout:
            return None


def generate_openrouter_text(prompt: str) -> Optional[str]:
    if not config.OPENROUTER_API_KEY or openai_lib is None:
        return None
    try:
        client = openai_lib.OpenAI(
            api_key=config.OPENROUTER_API_KEY,
            base_url=config.OPENROUTER_BASE_URL,
            timeout=60,
        )
        response = client.chat.completions.create(
            model=config.OPENROUTER_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=4000,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        print(f"OpenRouter error: {e}")
        return None


def generate_openrouter_text_with_timeout(prompt: str, timeout_seconds: int) -> Optional[str]:
    if timeout_seconds <= 0:
        return generate_openrouter_text(prompt)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(generate_openrouter_text, prompt)
        try:
            return future.result(timeout=timeout_seconds)
        except FutureTimeout:
            return None


def generate_groq_text(prompt: str, usage: Optional[Dict[str, int]] = None) -> Optional[str]:
    if not config.GROQ_API_KEY or GroqClient is None:
        return None

    client = GroqClient(api_key=config.GROQ_API_KEY, timeout=45)
    backoffs = [2, 4, 8]
    attempts = len(backoffs) + 1
    for attempt in range(attempts):
        try:
            _sleep_for_rpm()
            response = client.chat.completions.create(
                model=config.GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=4000,
            )
            if usage is not None:
                usage["calls"] = usage.get("calls", 0) + 1
                tokens = getattr(response, "usage", None)
                total_tokens = getattr(tokens, "total_tokens", None) if tokens else None
                if isinstance(total_tokens, int):
                    usage["tokens"] = usage.get("tokens", 0) + total_tokens
            return response.choices[0].message.content or ""
        except Exception as e:
            status = getattr(e, "status_code", None) or getattr(getattr(e, "response", None), "status_code", None)
            if usage is not None:
                usage["retries"] = usage.get("retries", 0) + 1
            if attempt < attempts - 1:
                retry_after = _extract_retry_after(e) if status == 429 else None
                # Cap retry-after to 30s to avoid sleeping for hours on daily limit hits
                time.sleep(min(retry_after or backoffs[attempt], 30))
                continue
            print(f"Groq error: {e}")
            return None


_BLOCKED_DOMAINS = (
    "linkedin.com",
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "glassdoor.com",
    "indeed.com",
    "reed.co.uk",
    "totaljobs.com",
    "cwjobs.co.uk",
    "jobsite.co.uk",
)


def _fetch_job_text_inner(url: str) -> str:
    import requests as _requests
    from bs4 import BeautifulSoup as _BS
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
        )
    }
    resp = _requests.get(url, headers=headers, timeout=(8, 15), allow_redirects=True)
    resp.raise_for_status()
    html = resp.text
    soup = _BS(html, "html.parser")
    for script in soup.find_all("script", type="application/ld+json"):
        if not script.string:
            continue
        try:
            payload = json.loads(script.string.strip())
        except ValueError:
            continue
        nodes = [payload] if isinstance(payload, dict) else (payload if isinstance(payload, list) else [])
        for node in nodes:
            if isinstance(node, dict) and node.get("@type") in ("JobPosting", "jobPosting"):
                desc = node.get("description") or ""
                if desc:
                    return _BS(desc, "html.parser").get_text(" ", strip=True)[:5000]
    og_desc = soup.find("meta", property="og:description")
    if og_desc and og_desc.get("content"):
        return og_desc.get("content", "")[:5000]
    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc and meta_desc.get("content"):
        return meta_desc.get("content", "")[:5000]
    return ""


def fetch_job_text(url: str) -> str:
    """Fetch job description text from the posting URL for LLM enrichment."""
    if not url:
        return ""
    # Skip domains that block scraping
    lower_url = url.lower()
    if any(domain in lower_url for domain in _BLOCKED_DOMAINS):
        return ""
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_fetch_job_text_inner, url)
        try:
            return future.result(timeout=20) or ""
        except Exception:
            return ""


def build_enhancement_prompt(record: JobRecord, job_text: str = "") -> str:
    text = job_text or record.notes or ""
    if text:
        role_summary_instruction = (
            "Role_summary must be STRICTLY based on job text and include two sections with bullet lines (use exact headings):\n"
            "Role responsibilities (what the job entails):\n- ...\n- ...\n"
            "What we're looking for (requirements/qualifications):\n- ...\n- ...\n"
            "Do not infer beyond job text. If not stated, write '- Not available in posting'.\n"
        )
    else:
        role_summary_instruction = (
            "No job text is available. For role_summary, use your knowledge of this company and role title "
            "to infer likely responsibilities and requirements. Use the headings:\n"
            "Role responsibilities (what the job entails):\n- ...\n- ...\n"
            "What we're looking for (requirements/qualifications):\n- ...\n- ...\n"
            "Clearly label these as inferred, e.g. '- Likely: ...'\n"
        )
    return (
        "You are a senior UK fintech product recruiter and ATS optimisation specialist. "
        "Given the candidate profile and job summary, score fit 0-100 and produce ATS-ready outputs. "
        "Make interview prep deeper and role-specific, grounded in the candidate's actual work. "
        "Return JSON ONLY with keys: fit_score (int), why_fit (string), cv_gap (string), "
        "prep_questions (array of 8-12 strings), prep_answers (array of 8-12 concise answer outlines "
        "matching prep_questions), scorecard (array of 5-7 criteria with what good looks like), "
        "apply_tips (string), role_summary (string), tailored_summary (string), "
        "tailored_cv_bullets (array of 4-6 bullet strings), key_requirements (array of strings), "
        "match_notes (string), company_insights (string), cover_letter (string), "
        "key_talking_points (array of 6-10 strings), star_stories (array of 6-8 STAR summaries with "
        "Situation/Task/Action/Result + metrics), quick_pitch (string), interview_focus (string), "
        "fit_verdict (string: exactly one of STRONG, PARTIAL, or STRETCH — "
        "STRONG = candidate directly meets most requirements, domain and seniority match, competitive application; "
        "PARTIAL = genuine overlap but meaningful gap in domain, seniority level, or role-type e.g. ops vs product; "
        "STRETCH = structural mismatch — wrong domain, significant seniority gap, or function mismatch e.g. compliance vs PM).\n\n"
        "ATS rules: plain text, no tables, no columns, no icons, no bullet symbols other than '- '. "
        "Bullets must be short, action-led, and include metrics if possible. "
        "If the job text includes Qualifications/Requirements, extract 3-6 key requirements into "
        "key_requirements and use match_notes to compare against the candidate profile.\n\n"
        + role_summary_instruction +
        "Tailored_summary must explicitly reference 2-3 stated job requirements and map them to the "
        "candidate's relevant experience.\n\n"
        f"Candidate profile: {config.JOB_DIGEST_PROFILE_TEXT}\n"
        f"Preferences: {config.PREFERENCES}\n\n"
        "Job:\n"
        f"Title: {record.role}\n"
        f"Company: {record.company}\n"
        f"Location: {record.location}\n"
        f"Posted: {record.posted}\n"
        f"Summary: {text}\n"
    )


def enhance_records_with_groq(records: List[JobRecord]) -> List[JobRecord]:
    if not config.GROQ_API_KEY or GroqClient is None:
        return records

    limit = min(config.GROQ_MAX_JOBS, len(records))
    usage = config.GROQ_USAGE
    warn_threshold = int(config.GROQ_DAILY_TOKEN_LIMIT * config.GROQ_TOKEN_WARN_RATIO)
    allow_groq = True
    for record in records[:limit]:
        if allow_groq and warn_threshold and usage.get("tokens", 0) >= warn_threshold:
            print("Groq token usage nearing daily limit; falling back to Gemini for remaining jobs.")
            allow_groq = False
        job_text = record.notes
        if not job_text and record.link:
            job_text = fetch_job_text(record.link)
        prompt = build_enhancement_prompt(record, job_text=job_text)
        text = generate_openrouter_text(prompt) if config.OPENROUTER_API_KEY else None
        if not text:
            text = generate_groq_text(prompt, usage=usage) if allow_groq else None
        if not text and config.GEMINI_API_KEY and genai is not None:
            text = generate_gemini_text_with_timeout(prompt, config.GEMINI_TIMEOUT_SECONDS)
        data = parse_gemini_payload(text or "")
        if not data:
            continue

        try:
            fit_score = int(data.get("fit_score", record.fit_score))
        except (TypeError, ValueError):
            fit_score = record.fit_score
        record.fit_score = max(0, min(100, fit_score))
        record.why_fit = data.get("why_fit", record.why_fit) or record.why_fit
        record.cv_gap = data.get("cv_gap", record.cv_gap) or record.cv_gap
        verdict = str(data.get("fit_verdict", "")).strip().upper()
        if verdict in ("STRONG", "PARTIAL", "STRETCH"):
            record.fit_verdict = verdict
        record.role_summary = data.get("role_summary", record.role_summary) or record.role_summary
        record.tailored_summary = data.get("tailored_summary", record.tailored_summary) or record.tailored_summary
        record.quick_pitch = data.get("quick_pitch", record.quick_pitch) or record.quick_pitch
        record.interview_focus = data.get("interview_focus", record.interview_focus) or record.interview_focus
        record.match_notes = data.get("match_notes", record.match_notes) or record.match_notes
        record.company_insights = data.get("company_insights", record.company_insights) or record.company_insights
        record.cover_letter = data.get("cover_letter", record.cover_letter) or record.cover_letter
        record.apply_tips = data.get("apply_tips", record.apply_tips) or record.apply_tips

        for list_key in (
            "tailored_cv_bullets",
            "key_requirements",
            "key_talking_points",
            "star_stories",
            "prep_questions",
            "prep_answers",
            "scorecard",
        ):
            val = data.get(list_key)
            if isinstance(val, list) and val:
                setattr(record, list_key, [str(v) for v in val])

    if usage.get("calls", 0) or usage.get("retries", 0):
        print(
            "Groq summary:",
            f"{usage.get('calls', 0)} calls, {usage.get('retries', 0)} retries, {usage.get('tokens', 0)} tokens",
        )

    return records


def enhance_records_with_gemini(records: List[JobRecord]) -> List[JobRecord]:
    if not config.GEMINI_API_KEY or genai is None:
        return records

    limit = min(config.GEMINI_MAX_JOBS, len(records))
    for record in records[:limit]:
        job_text = record.notes
        if not job_text and record.link:
            job_text = fetch_job_text(record.link)
        prompt = build_enhancement_prompt(record, job_text=job_text)
        text = generate_gemini_text_with_timeout(prompt, config.GEMINI_TIMEOUT_SECONDS)
        data = parse_gemini_payload(text or "")
        if not data:
            continue

        try:
            fit_score = int(data.get("fit_score", record.fit_score))
        except (TypeError, ValueError):
            fit_score = record.fit_score
        record.fit_score = max(0, min(100, fit_score))
        record.why_fit = data.get("why_fit", record.why_fit) or record.why_fit
        record.cv_gap = data.get("cv_gap", record.cv_gap) or record.cv_gap
        verdict = str(data.get("fit_verdict", "")).strip().upper()
        if verdict in ("STRONG", "PARTIAL", "STRETCH"):
            record.fit_verdict = verdict
        prep_questions = data.get("prep_questions", record.prep_questions)
        if isinstance(prep_questions, str):
            prep_questions = [prep_questions]
        if isinstance(prep_questions, list):
            record.prep_questions = [str(q).strip() for q in prep_questions if str(q).strip()]
        prep_answers = data.get("prep_answers", record.prep_answers)
        if isinstance(prep_answers, str):
            prep_answers = [prep_answers]
        if isinstance(prep_answers, list):
            record.prep_answers = [str(a).strip() for a in prep_answers if str(a).strip()]
        scorecard = data.get("scorecard", record.scorecard)
        if isinstance(scorecard, str):
            scorecard = [scorecard]
        if isinstance(scorecard, list):
            record.scorecard = [str(s).strip() for s in scorecard if str(s).strip()]
        record.apply_tips = data.get("apply_tips", record.apply_tips) or record.apply_tips
        record.role_summary = data.get("role_summary", record.role_summary) or record.role_summary
        record.tailored_summary = data.get("tailored_summary", record.tailored_summary) or record.tailored_summary
        bullets = data.get("tailored_cv_bullets", record.tailored_cv_bullets)
        if isinstance(bullets, str):
            bullets = [bullets]
        if isinstance(bullets, list):
            record.tailored_cv_bullets = [str(b).strip() for b in bullets if str(b).strip()]
        requirements = data.get("key_requirements", record.key_requirements)
        if isinstance(requirements, str):
            requirements = [requirements]
        if isinstance(requirements, list):
            record.key_requirements = [str(r).strip() for r in requirements if str(r).strip()]
        record.match_notes = data.get("match_notes", record.match_notes) or record.match_notes
        record.company_insights = data.get("company_insights", record.company_insights) or record.company_insights
        record.cover_letter = data.get("cover_letter", record.cover_letter) or record.cover_letter
        talking = data.get("key_talking_points", record.key_talking_points)
        if isinstance(talking, str):
            talking = [talking]
        if isinstance(talking, list):
            record.key_talking_points = [str(t).strip() for t in talking if str(t).strip()]
        stories = data.get("star_stories", record.star_stories)
        if isinstance(stories, str):
            stories = [stories]
        if isinstance(stories, list):
            record.star_stories = [str(s).strip() for s in stories if str(s).strip()]
        record.quick_pitch = data.get("quick_pitch", record.quick_pitch) or record.quick_pitch
        record.interview_focus = data.get("interview_focus", record.interview_focus) or record.interview_focus

        time.sleep(0.25)

    return records


def enhance_records_with_openai_cv(records: List[JobRecord]) -> List[JobRecord]:
    """Generate tailored CV sections via OpenAI for each record."""
    if not config.OPENAI_API_KEY or openai_lib is None:
        return records

    client = openai_lib.OpenAI(api_key=config.OPENAI_API_KEY)
    limit = min(config.OPENAI_CV_MAX_JOBS, len(records))

    for record in records[:limit]:
        prompt = (
            "You are a senior CV writer specialising in UK fintech and financial services product roles. "
            "Given the candidate's real CV text and a target job description, produce tailored CV section "
            "replacements that will pass ATS screening and impress a hiring manager.\n\n"
            "Return JSON ONLY with a single key 'tailored_cv_sections' containing:\n"
            "- summary: 2-3 sentence professional summary tailored to this specific role\n"
            "- key_achievements: array of 5-7 bullet strings reordered/rewritten from the candidate's "
            "real achievements to emphasise relevance to this JD (start each with '- ')\n"
            "- vistra_bullets: array of 8-10 bullet strings for the Vistra Corporate Services role "
            "tailored to this JD (start each with '- ')\n"
            "- ebury_bullets: array of 4-5 bullet strings for the Ebury Partners role "
            "tailored to this JD (start each with '- ')\n\n"
            "Rules: plain text only, no tables, no icons. Bullets must be action-led with metrics. "
            "Keep the candidate's real experience — rewrite emphasis and ordering, don't fabricate.\n\n"
            f"Candidate CV:\n{config.JOB_DIGEST_PROFILE_TEXT}\n\n"
            "Target job:\n"
            f"Title: {record.role}\n"
            f"Company: {record.company}\n"
            f"Location: {record.location}\n"
            f"Summary: {record.notes}\n"
        )
        try:
            response = client.chat.completions.create(
                model=config.OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                max_tokens=2000,
            )
            text = response.choices[0].message.content or ""
            data = parse_gemini_payload(text)  # reuse JSON extractor
            if data:
                sections = data.get("tailored_cv_sections", data)
                if isinstance(sections, dict):
                    record.tailored_cv_sections = sections
        except Exception as e:
            print(f"OpenAI CV generation failed for {record.role} at {record.company}: {e}")
            continue

        time.sleep(0.3)

    return records
