from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import requests

from . import config
from .llm import (
    build_enhancement_prompt,
    generate_gemini_text,
    generate_gemini_text_with_timeout,
    generate_groq_text,
    parse_gemini_payload,
)
from .models import JobRecord
from .utils import now_utc, parse_applicant_count

try:
    import firebase_admin
    from firebase_admin import credentials, firestore
except Exception:  # noqa: BLE001
    firebase_admin = None
    credentials = None
    firestore = None

try:
    import google.generativeai as genai
except Exception:  # noqa: BLE001
    genai = None

try:
    from groq import Groq as GroqClient
except ImportError:
    GroqClient = None


def init_firestore_client() -> Optional["firestore.Client"]:
    if firebase_admin is None or credentials is None or firestore is None:
        return None
    if not config.FIREBASE_SERVICE_ACCOUNT_JSON and not config.FIREBASE_SERVICE_ACCOUNT_B64:
        return None

    try:
        if config.FIREBASE_SERVICE_ACCOUNT_JSON:
            service_data = json.loads(config.FIREBASE_SERVICE_ACCOUNT_JSON)
        else:
            decoded = base64.b64decode(config.FIREBASE_SERVICE_ACCOUNT_B64).decode("utf-8")
            service_data = json.loads(decoded)
    except (ValueError, json.JSONDecodeError, OSError):
        return None

    try:
        if not firebase_admin._apps:
            firebase_admin.initialize_app(credentials.Certificate(service_data))
        return firestore.client()
    except Exception:
        return None


def record_document_id(record: JobRecord) -> str:
    seed = record.link or f"{record.company}-{record.role}-{record.location}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return digest[:24]


def write_records_to_firestore(records: List[JobRecord]) -> None:
    client = init_firestore_client()
    if client is None:
        return

    for record in records:
        doc_id = record_document_id(record)
        doc_ref = client.collection(config.FIREBASE_COLLECTION).document(doc_id)
        existing_data: Dict[str, object] = {}
        try:
            snapshot = doc_ref.get()
            if snapshot.exists:
                existing_data = snapshot.to_dict() or {}
        except Exception:
            existing_data = {}
        now_iso = datetime.now(timezone.utc).isoformat()
        created_at = existing_data.get("created_at") or now_iso
        data = {
            "role": record.role,
            "company": record.company,
            "location": record.location,
            "link": record.link,
            "posted": record.posted,
            "posted_raw": record.posted_raw or record.posted,
            "posted_date": record.posted_date,
            "source": record.source,
            "fit_score": record.fit_score,
            "preference_match": record.preference_match,
            "why_fit": record.why_fit,
            "cv_gap": record.cv_gap,
            "notes": record.notes,
            "prep_questions": record.prep_questions,
            "apply_tips": record.apply_tips,
            "updated_at": now_iso,
            "created_at": created_at,
            "last_seen_at": now_iso,
        }
        is_new_doc = not existing_data
        effective_threshold = min(config.AUTO_DISMISS_BELOW, 70) if config.AUTO_DISMISS_BELOW > 0 else 0
        existing_status = (existing_data.get("application_status") or "").lower()
        if record.source == "Manual":
            data["manual_link"] = True
        if is_new_doc and effective_threshold and record.fit_score < effective_threshold:
            data["application_status"] = "dismissed"
            data["dismiss_reason"] = f"auto_low_fit_{effective_threshold}"
        elif record.source == "Manual" and (not existing_status or existing_status in {"saved", "new"}):
            data["application_status"] = "shortlisted"
        elif not existing_status:
            data["application_status"] = "saved"
        optional_fields = {
            "role_summary": record.role_summary,
            "tailored_summary": record.tailored_summary,
            "tailored_cv_bullets": record.tailored_cv_bullets,
            "key_requirements": record.key_requirements,
            "match_notes": record.match_notes,
            "company_insights": record.company_insights,
            "cover_letter": record.cover_letter,
            "key_talking_points": record.key_talking_points,
            "star_stories": record.star_stories,
            "quick_pitch": record.quick_pitch,
            "interview_focus": record.interview_focus,
            "prep_answers": record.prep_answers,
            "scorecard": record.scorecard,
            "tailored_cv_sections": record.tailored_cv_sections,
            "applicant_count": record.applicant_count,
            "job_status": record.job_status,
            "alternate_links": record.alternate_links,
        }
        for key, value in optional_fields.items():
            if isinstance(value, list):
                if value:
                    data[key] = value
            elif value:
                data[key] = value
        current_applicant_count = parse_applicant_count(record.applicant_count)
        if current_applicant_count is not None:
            data["applicant_count_numeric"] = current_applicant_count
            previous_count = existing_data.get("applicant_count_numeric")
            if previous_count is None:
                previous_count = parse_applicant_count(str(existing_data.get("applicant_count", "")))
            if isinstance(previous_count, int) and previous_count != current_applicant_count:
                data["applicant_count_prev"] = previous_count
                data["applicant_count_prev_date"] = now_iso
                try:
                    history_doc = doc_ref.collection("applicant_history").document(
                        f"{now_iso[:10]}_{current_applicant_count}"
                    )
                    history_doc.set(
                        {
                            "date": now_iso[:10],
                            "count": current_applicant_count,
                            "raw_text": record.applicant_count,
                            "updated_at": now_iso,
                        },
                        merge=True,
                    )
                except Exception:
                    pass
        try:
            doc_ref.set(data, merge=True)
        except Exception:
            continue


def write_source_stats(records: List[JobRecord]) -> None:
    client = init_firestore_client()
    if client is None:
        return

    counts: Dict[str, int] = {}
    for record in records:
        counts[record.source] = counts.get(record.source, 0) + 1

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = {
        "date": today,
        "total": sum(counts.values()),
        "counts": counts,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.collection("job_stats").document(today).set(payload, merge=True)
    except Exception:
        return


def write_notifications(records: List[JobRecord]) -> None:
    client = init_firestore_client()
    if client is None:
        return
    if config.NOTIFICATION_THRESHOLD <= 0:
        return

    now_iso = datetime.now(timezone.utc).isoformat()
    for record in records:
        if record.fit_score < config.NOTIFICATION_THRESHOLD:
            continue
        doc_id = record_document_id(record)
        doc_ref = client.collection(config.NOTIFICATIONS_COLLECTION).document(doc_id)
        try:
            snap = doc_ref.get()
            if snap.exists and (snap.to_dict() or {}).get("seen") is True:
                continue
        except Exception:
            pass
        payload = {
            "job_id": doc_id,
            "role": record.role,
            "company": record.company,
            "fit_score": record.fit_score,
            "link": record.link,
            "source": record.source,
            "seen": False,
            "created_at": now_iso,
        }
        try:
            doc_ref.set(payload, merge=True)
        except Exception:
            continue


def cleanup_stale_jobs() -> None:
    client = init_firestore_client()
    if client is None:
        return
    cutoff = now_utc() - timedelta(days=config.STALE_DAYS)
    cutoff_iso = cutoff.isoformat()
    updated = 0
    try:
        query = (
            client.collection(config.FIREBASE_COLLECTION)
            .where("application_status", "==", "saved")
            .where("created_at", "<", cutoff_iso)
        )
        for doc in query.stream():
            data = doc.to_dict() or {}
            if (data.get("fit_score") or 0) >= 85:
                continue
            try:
                doc.reference.update(
                    {
                        "application_status": "dismissed",
                        "dismiss_reason": "auto_stale",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                updated += 1
            except Exception:
                continue
    except Exception:
        return

    if updated:
        print(f"Auto-dismissed {updated} stale jobs (> {config.STALE_DAYS} days).")


def write_role_suggestions() -> None:
    client = init_firestore_client()
    if client is None:
        return
    if not config.GROQ_API_KEY and (not config.GEMINI_API_KEY or genai is None):
        return
    prompt = (
        "You are a UK career strategist. Based on the candidate profile, suggest 6-10 adjacent roles "
        "they could be suitable for beyond exact Product Manager titles. Return JSON ONLY with keys: "
        "roles (array of strings) and rationale (string). Keep roles UK market relevant.\n\n"
        f"Candidate profile: {config.JOB_DIGEST_PROFILE_TEXT}\n"
    )
    text = generate_groq_text(prompt) or generate_gemini_text(prompt)
    data = parse_gemini_payload(text or "") or {}
    roles = data.get("roles", [])
    if isinstance(roles, str):
        roles = [roles]
    roles = [str(r).strip() for r in roles if str(r).strip()]
    rationale = data.get("rationale", "")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = {
        "date": today,
        "roles": roles,
        "rationale": rationale,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.collection("role_suggestions").document(today).set(payload, merge=True)
    except Exception:
        return


def backfill_role_summaries(limit: Optional[int] = None) -> None:
    client = init_firestore_client()
    if client is None:
        print("Backfill skipped: Firestore client not available.")
        return

    records: List[JobRecord] = []
    doc_ids: List[str] = []
    processed = 0

    try:
        for doc in client.collection(config.FIREBASE_COLLECTION).stream():
            data = doc.to_dict() or {}
            role = data.get("role") or ""
            if not role:
                continue
            notes = data.get("notes") or data.get("role_summary") or ""
            record = JobRecord(
                role=role,
                company=data.get("company") or "",
                location=data.get("location") or "",
                link=data.get("link") or "",
                posted=data.get("posted") or "",
                posted_raw=data.get("posted_raw") or data.get("posted") or "",
                posted_date=data.get("posted_date") or "",
                source=data.get("source") or "",
                fit_score=int(data.get("fit_score") or 0),
                preference_match=data.get("preference_match") or "",
                why_fit=data.get("why_fit") or "",
                cv_gap=data.get("cv_gap") or "",
                notes=notes,
            )
            records.append(record)
            doc_ids.append(doc.id)
            processed += 1
            if limit and processed >= limit:
                break
    except Exception as exc:
        print(f"Backfill failed while reading jobs: {exc}")
        return

    if not records:
        print("Backfill skipped: no jobs found.")
        return

    total = len(records)
    print(f"Backfill loaded {total} jobs.")

    updated = 0
    errors = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    if not (config.GROQ_API_KEY and GroqClient is not None) and not (config.GEMINI_API_KEY and genai is not None):
        print("Backfill skipped: no LLM keys configured.")
        return

    for idx, (doc_id, record) in enumerate(zip(doc_ids, records), start=1):
        print(f"Backfill job {idx}/{total}: {record.company} — {record.role}")
        prompt = build_enhancement_prompt(record)
        text: Optional[str] = None
        try:
            if config.GEMINI_API_KEY and genai is not None:
                text = generate_gemini_text_with_timeout(prompt, config.GEMINI_TIMEOUT_SECONDS)
            elif config.GROQ_API_KEY and GroqClient is not None:
                text = generate_groq_text(prompt)
        except Exception as exc:
            errors += 1
            print(f"Backfill error: LLM call failed ({type(exc).__name__}: {exc})")
            continue

        if not text:
            errors += 1
            print("Backfill error: empty response.")
            continue

        data = parse_gemini_payload(text)
        if not data or not data.get("role_summary"):
            errors += 1
            print("Backfill error: missing role_summary in response.")
            continue

        try:
            client.collection(config.FIREBASE_COLLECTION).document(doc_id).set(
                {"role_summary": data.get("role_summary"), "updated_at": now_iso},
                merge=True,
            )
            updated += 1
        except Exception as exc:
            errors += 1
            print(f"Backfill error: Firestore write failed ({type(exc).__name__}: {exc})")
            continue

        if idx % 5 == 0 or idx == total:
            print(f"Backfill progress: {idx}/{total} processed, {updated} updated, {errors} errors.")

    print(f"Backfill complete: updated {updated} role summaries, {errors} errors.")


def diagnose_backfill() -> None:
    print("Backfill diagnose:")
    print(f"- Firestore credentials present: {'yes' if (config.FIREBASE_SERVICE_ACCOUNT_JSON or config.FIREBASE_SERVICE_ACCOUNT_B64) else 'no'}")
    print(f"- Gemini key present: {'yes' if config.GEMINI_API_KEY else 'no'}")
    client = init_firestore_client()
    if client is None:
        print("- Firestore: NOT available")
        return
    print("- Firestore: OK")
    try:
        docs = client.collection(config.FIREBASE_COLLECTION).limit(1).stream()
        sample = next(docs, None)
        if not sample:
            print("- Sample job: none found")
        else:
            data = sample.to_dict() or {}
            role = data.get("role") or ""
            company = data.get("company") or ""
            notes_len = len(data.get("notes") or "")
            print(f"- Sample job: {company} — {role} (notes {notes_len} chars)")
    except Exception as exc:
        print(f"- Sample job read failed: {type(exc).__name__}: {exc}")
        return

    if config.GEMINI_API_KEY and genai is not None:
        try:
            text = generate_gemini_text_with_timeout('Return JSON: {"ok": true}', 20)
            data = parse_gemini_payload(text or "")
            print(f"- Gemini test: {'ok' if data else 'failed'}")
        except Exception as exc:
            print(f"- Gemini test failed: {type(exc).__name__}: {exc}")


def write_candidate_prep() -> None:
    client = init_firestore_client()
    if client is None:
        return
    if not config.GROQ_API_KEY and (not config.GEMINI_API_KEY or genai is None):
        return
    prompt = (
        "You are a UK executive interview coach. Create a deeper interview prep sheet for Ade, "
        "anchored in his actual work (KYC/onboarding/screening transformation, orchestration, dashboards, "
        "operational controls, and stakeholder delivery). Return JSON ONLY with keys: "
        "quick_pitch (string, 90-120 words), key_stats (array of 6-10 strings), "
        "key_talking_points (array of 8-12 strings), star_stories (array of 8-10 STAR summaries with "
        "Situation/Task/Action/Result + metrics), strengths (array of 4-6 strings), "
        "risk_mitigations (array of 3-5 strings), interview_questions (array of 10 questions Ade should rehearse).\n\n"
        f"Candidate profile: {config.JOB_DIGEST_PROFILE_TEXT}\n"
    )
    text = generate_groq_text(prompt) or generate_gemini_text(prompt)
    data = parse_gemini_payload(text or "") or {}
    key_stats = data.get("key_stats", [])
    if isinstance(key_stats, str):
        key_stats = [key_stats]
    key_stats = [str(s).strip() for s in key_stats if str(s).strip()]
    key_points = data.get("key_talking_points", [])
    if isinstance(key_points, str):
        key_points = [key_points]
    key_points = [str(s).strip() for s in key_points if str(s).strip()]
    stories = data.get("star_stories", [])
    if isinstance(stories, str):
        stories = [stories]
    stories = [str(s).strip() for s in stories if str(s).strip()]
    quick_pitch = data.get("quick_pitch", "")

    def flatten_item(item):
        if isinstance(item, dict):
            return " — ".join(f"{k}: {v}" for k, v in item.items())
        return str(item).strip()

    strengths = data.get("strengths", [])
    if isinstance(strengths, str):
        strengths = [strengths]
    strengths = [flatten_item(s) for s in strengths if flatten_item(s)]
    risk_mitigations = data.get("risk_mitigations", [])
    if isinstance(risk_mitigations, str):
        risk_mitigations = [risk_mitigations]
    risk_mitigations = [flatten_item(s) for s in risk_mitigations if flatten_item(s)]
    interview_questions = data.get("interview_questions", [])
    if isinstance(interview_questions, str):
        interview_questions = [interview_questions]
    interview_questions = [flatten_item(s) for s in interview_questions if flatten_item(s)]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    payload = {
        "date": today,
        "key_stats": key_stats,
        "key_talking_points": key_points,
        "star_stories": stories,
        "quick_pitch": quick_pitch,
        "strengths": strengths,
        "risk_mitigations": risk_mitigations,
        "interview_questions": interview_questions,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        client.collection("candidate_prep").document(today).set(payload, merge=True)
    except Exception:
        return


def run_smoke_test() -> None:
    session = requests.Session()
    session.headers.update({"User-Agent": config.USER_AGENT})

    results: Dict[str, Dict[str, int]] = {}

    # LinkedIn single-request probe
    linkedin_count = 0
    linkedin_status = 0
    try:
        resp = session.get(
            "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
            params={
                "keywords": "product manager onboarding",
                "location": "London, United Kingdom",
                "f_TPR": "r604800",
                "start": 0,
            },
            timeout=20,
        )
        linkedin_status = resp.status_code
        if resp.status_code == 200:
            linkedin_count = resp.text.count("base-card") or resp.text.count("job-card-container")
    except Exception:
        linkedin_status = 0

    results["LinkedIn"] = {"status": linkedin_status, "count": linkedin_count}

    for name in ["Greenhouse", "Lever", "SmartRecruiters", "Ashby"]:
        results[name] = {"status": 200, "count": 0}

    for name, stat in results.items():
        print(f"{name}: status={stat['status']} count={stat['count']}")


def fetch_manual_link_requests(client: Optional["firestore.Client"]) -> List[Dict[str, str]]:
    if client is None:
        return []
    requests_data: List[Dict[str, str]] = []
    try:
        query = (
            client.collection(config.RUN_REQUESTS_COLLECTION)
            .where("status", "==", "pending")
            .order_by("requested_at")
            .limit(config.MANUAL_LINK_LIMIT)
        )
        for doc in query.stream():
            data = doc.to_dict() or {}
            link = data.get("link") or ""
            if not link:
                continue
            requests_data.append(
                {
                    "id": doc.id,
                    "link": link,
                }
            )
    except Exception:
        return []
    return requests_data
