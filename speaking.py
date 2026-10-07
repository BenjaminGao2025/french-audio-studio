"""
French Audio Studio - Speaking practice for TCF Canada Expression Orale (EO).

Tasks:
  - T1: Entretien dirigé (~2 min, 4–6 questions)
  - T2: Exercice en interaction (2 min prep + 3:30 min conversation)
  - T3: Expression d'un point de vue (4:30 min monologue, 1.5–2 min for A1–A2)

Feedback follows two-round guided feedback from the machine transcript:
  - Round 1: Checklist (question count/syntax for T2, structure for T3),
             WPM & speaking time, praise, and up to 8 error hints (no answers).
  - Round 2: Fixed verification, minimal sentence corrections with SRS card buttons,
             and up to 3 reusable spoken structures.
"""

from __future__ import annotations

import datetime
import json
import re
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

import auth_db

ALLOWED_ERROR_TYPES = {
    "agreement",
    "verb form",
    "gender",
    "word order",
    "spelling / accents",
    "wrong word",
    "missing word",
}

TASKS: dict[str, dict[str, Any]] = {
    "T1": {
        "id": "T1",
        "name": "Tâche 1 : Entretien dirigé",
        "name_en": "Task 1: Guided interview",
        "desc": "L'examinateur pose 4 à 6 questions personnelles sur votre vie quotidienne, votre travail ou vos projets (environ 2 min).",
        "desc_en": "The examiner asks 4–6 personal questions about your daily life, work, or plans (~2 min).",
        "timer_seconds": 120,
        "recommended_levels": ("A1", "A2"),
    },
    "T2": {
        "id": "T2",
        "name": "Tâche 2 : Exercice en interaction",
        "name_en": "Task 2: Role-play interaction",
        "desc": "Vous devez poser des questions pour obtenir des informations sur une situation de la vie quotidienne (3 min 30).",
        "desc_en": "You ask the questions to obtain information in a daily-life situation (3m 30s).",
        "timer_seconds": 210,
        "prep_seconds": 120,
        "recommended_levels": ("B1",),
    },
    "T3": {
        "id": "T3",
        "name": "Tâche 3 : Expression d'un point de vue",
        "name_en": "Task 3: Opinion monologue",
        "desc": "Présenter votre opinion argumentée sur un sujet de société : prise de position, arguments, exemple, conclusion (4 min 30).",
        "desc_en": "Present your reasoned opinion on a topic: stance, arguments, example, conclusion (4m 30s).",
        "timer_seconds": 270,
        "timer_seconds_beginner": 120,
        "recommended_levels": ("B2",),
    },
}

SUBJECTS: dict[str, list[dict[str, Any]]] = {
    "T1": [
        {
            "id": "t1_s1",
            "title": "Présentation et ville d'origine",
            "prompt": "Parlez-moi de vous et de l'endroit où vous habitez.",
            "questions": [
                "Bonjour ! Pour commencer, comment vous vous appelez et où habitez-vous actuellement ?",
                "Pouvez-vous me décrire brièvement votre quartier ou votre ville ?",
                "Depuis combien de temps vivez-vous à cet endroit ?",
                "Qu'est-ce qui vous plaît le plus dans votre ville au quotidien ?",
            ],
        },
        {
            "id": "t1_s2",
            "title": "Le travail ou les études",
            "prompt": "Parlez-moi de votre activité professionnelle ou de vos études.",
            "questions": [
                "Quelle est votre profession ou quel domaine étudiez-vous ?",
                "À quoi ressemble une journée type pour vous dans votre travail ou vos études ?",
                "Pourquoi avez-vous choisi ce domaine ?",
                "Qu'est-ce qui vous semble le plus intéressant ou stimulant dans ce que vous faites ?",
            ],
        },
        {
            "id": "t1_s3",
            "title": "Les loisirs et le week-end",
            "prompt": "Parlez-moi de vos passe-temps et de vos fins de semaine.",
            "questions": [
                "Que faites-vous généralement pendant votre temps libre ou le week-end ?",
                "Avez-vous une passion, un passe-temps créatif ou un sport préféré ?",
                "Racontez-moi ce que vous avez fait le week-end dernier.",
                "Préférez-vous passer votre temps libre seul ou avec des amis ?",
            ],
        },
        {
            "id": "t1_s4",
            "title": "L'apprentissage du français et le projet au Canada",
            "prompt": "Parlez-moi de votre apprentissage de la langue et de vos projets.",
            "questions": [
                "Depuis combien de temps apprenez-vous le français ?",
                "Comment étudiez-vous le français au quotidien ?",
                "Pourquoi souhaitez-vous vous installer ou voyager au Canada ?",
                "Quelle ville ou province canadienne aimeriez-vous particulièrement découvrir ?",
            ],
        },
        {
            "id": "t1_s5",
            "title": "Les vacances et les voyages",
            "prompt": "Parlez-moi de vos habitudes de vacances et de vos voyages.",
            "questions": [
                "Où aimez-vous partir en vacances en général ?",
                "Préférez-vous la mer, la montagne ou visiter de grandes villes ?",
                "Racontez-moi un voyage ou des vacances qui vous ont particulièrement marqué.",
                "Quelle serait votre prochaine destination de rêve ?",
            ],
        },
        {
            "id": "t1_s6",
            "title": "Les repas et la cuisine",
            "prompt": "Parlez-moi de votre alimentation et de vos goûts culinaires.",
            "questions": [
                "Quel est votre plat préféré ?",
                "Aimez-vous cuisiner chez vous ou préférez-vous aller au restaurant ?",
                "À quelle heure prenez-vous généralement vos repas dans la journée ?",
                "Parlez-moi d'un plat traditionnel important dans votre culture.",
            ],
        },
        {
            "id": "t1_s7",
            "title": "Le logement",
            "prompt": "Parlez-moi de votre lieu de vie.",
            "questions": [
                "Habitez-vous dans une maison ou dans un appartement ?",
                "Quelle est votre pièce préférée chez vous et pourquoi ?",
                "Si vous pouviez changer quelque chose dans votre logement, ce serait quoi ?",
                "Préférez-vous vivre au centre-ville ou dans un quartier calme en banlieue ?",
            ],
        },
        {
            "id": "t1_s8",
            "title": "Les saisons et le climat",
            "prompt": "Parlez-moi de votre rapport à la météo et aux saisons.",
            "questions": [
                "Quelle est votre saison préférée dans l'année et pour quelle raison ?",
                "Quel temps fait-il aujourd'hui dans votre région ?",
                "Avez-vous déjà vécu un hiver très froid avec de la neige ?",
                "Quelles activités aimez-vous faire quand il fait beau en été ?",
            ],
        },
        {
            "id": "t1_s9",
            "title": "La technologie et les écrans",
            "prompt": "Parlez-moi de votre utilisation des nouvelles technologies.",
            "questions": [
                "Combien de temps passez-vous par jour sur votre téléphone ou ordinateur ?",
                "Quelles applications mobiles utilisez-vous le plus fréquemment ?",
                "Que pensez-vous des réseaux sociaux ?",
                "Préférez-vous lire des livres papier ou sur un écran ?",
            ],
        },
        {
            "id": "t1_s10",
            "title": "Les amis et la famille",
            "prompt": "Parlez-moi des personnes qui vous entourent.",
            "questions": [
                "Parlez-moi d'un ami proche ou d'un membre de votre famille.",
                "Quelles activités aimez-vous partager ensemble ?",
                "À quelle fréquence vous retrouvez-vous ?",
                "Quelles qualités appréciez-vous le plus chez un ami ?",
            ],
        },
    ],
    "T2": [
        {
            "id": "t2_s1",
            "title": "Inscription à un centre sportif",
            "prompt": "Vous voulez vous inscrire à un centre sportif à Montréal. Vous posez des questions à l'employé(e) pour obtenir des renseignements.",
            "role_examiner": "Vous êtes l'employé à l'accueil du centre sportif. Répondez poliment et brièvement aux questions du candidat.",
            "target_points": ["Horaires d'ouverture", "Tarifs des abonnements", "Cours collectifs disponibles", "Équipement requis"],
        },
        {
            "id": "t2_s2",
            "title": "Renseignements à la bibliothèque municipale",
            "prompt": "Vous visitez la bibliothèque municipale de votre quartier à Québec pour la première fois. Vous demandez les informations nécessaires pour vous abonner.",
            "role_examiner": "Vous êtes bibliothécaire. Répondez de manière chaleureuse et concise aux questions du candidat.",
            "target_points": ["Conditions et pièces pour s'inscrire", "Nombre de livres et durée d'emprunt", "Accès aux ordinateurs / wifi", "Ateliers culturels proposés"],
        },
        {
            "id": "t2_s3",
            "title": "Location d'une voiture pour le week-end",
            "prompt": "Vous souhaitez louer une voiture à Ottawa pour une excursion de fin de semaine. Vous vous adressez à l'agence de location.",
            "role_examiner": "Vous êtes l'agent de l'agence de location de voitures. Répondez aux questions avec clarté.",
            "target_points": ["Types de véhicules disponibles", "Tarif pour deux jours", "Kilométrage illimité et assurances", "Conditions de retour du véhicule"],
        },
        {
            "id": "t2_s4",
            "title": "Organisation d'un repas de groupe au restaurant",
            "prompt": "Vous organisez un dîner d'anniversaire pour dix personnes dans un restaurant français. Vous demandez les détails au gérant.",
            "role_examiner": "Vous êtes le gérant du restaurant. Répondez aux questions de réservation.",
            "target_points": ["Disponibilité pour samedi soir", "Menu de groupe ou à la carte", "Options pour les régimes alimentaires (végétarien, sans gluten)", "Montant de l'acompte nécessaire"],
        },
        {
            "id": "t2_s5",
            "title": "Cours de français langue seconde",
            "prompt": "Vous cherchez une formation en français pour adultes. Vous téléphonez à une école de langues pour avoir des informations.",
            "role_examiner": "Vous êtes le responsable pédagogique de l'école de langues.",
            "target_points": ["Test d'évaluation du niveau", "Horaires du soir ou du samedi", "Nombre d'étudiants par classe", "Tarif et attestation délivrée"],
        },
        {
            "id": "t2_s6",
            "title": "Renseignements à l'office de tourisme",
            "prompt": "Vous venez d'arriver dans une région touristique (ex. Banff). Vous demandez des conseils à l'agent d'accueil.",
            "role_examiner": "Vous êtes conseiller en séjour à l'office de tourisme.",
            "target_points": ["Randonnées faciles à la journée", "Moyens de transport ou navettes", "Météo et consignes de sécurité", "Tarifs des parcs nationaux"],
        },
        {
            "id": "t2_s7",
            "title": "Adhésion à un club de cuisine locale",
            "prompt": "Vous souhaitez rejoindre une association de cuisine de quartier. Vous posez des questions à un responsable.",
            "role_examiner": "Vous êtes animateur du club de cuisine associative.",
            "target_points": ["Fréquence des ateliers", "Niveau de cuisine requis", "Ingrédients fournis ou à apporter", "Cotisation annuelle"],
        },
        {
            "id": "t2_s8",
            "title": "Achat d'un vélo d'occasion",
            "prompt": "Vous répondez à une annonce en ligne pour acheter un vélo d'occasion. Vous posez des questions au vendeur.",
            "role_examiner": "Vous êtes le particulier qui vend son vélo.",
            "target_points": ["Âge et état du vélo (freins, pneus)", "Raison de la vente", "Accessoires inclus (antivol, casque)", "Possibilité d'essayer le vélo et négocier le prix"],
        },
        {
            "id": "t2_s9",
            "title": "Inscription d'un enfant à un camp de jour",
            "prompt": "Vous cherchez un camp de jour pour votre enfant pendant les vacances d'été. Vous interrogez le directeur du centre de loisirs.",
            "role_examiner": "Vous êtes directeur du camp de vacances.",
            "target_points": ["Tranches d'âge acceptées", "Horaires d'accueil matin et soir", "Activités prévues et sorties", "Fourniture des repas et collations"],
        },
        {
            "id": "t2_s10",
            "title": "Abonnement de transport en commun",
            "prompt": "Vous venez de vous installer dans une ville canadienne. Vous demandez des informations au guichet de transport pour choisir votre titre de transport.",
            "role_examiner": "Vous êtes agent au guichet du réseau de transport urbain.",
            "target_points": ["Tarif mensuel de la carte", "Zones et lignes incluses (bus, métro)", "Tarifs réduits (étudiants, nouveaux arrivants)", "Moyens de rechargement en ligne"],
        },
    ],
    "T3": [
        {
            "id": "t3_s1",
            "title": "Le travail à distance généralisé",
            "prompt": "« Le travail à distance à temps plein est une opportunité formidable pour les salariés et les entreprises. » Partagez-vous ce point de vue ?",
            "structure_hints": ["Votre position claire", "Argument 1 : bien-être / gain de temps", "Argument 2 : risque d'isolement ou limites", "Exemple concret", "Conclusion"],
        },
        {
            "id": "t3_s2",
            "title": "La gratuité des transports en commun",
            "prompt": "« Tous les transports en commun devraient être totalement gratuits pour encourager la transition écologique. » Qu'en pensez-vous ?",
            "structure_hints": ["Votre position", "Argument 1 : impact environnemental et justice sociale", "Argument 2 : coût économique et entretien", "Exemple de ville", "Conclusion"],
        },
        {
            "id": "t3_s3",
            "title": "Les téléphones portables à l'école",
            "prompt": "« Les téléphones intelligents devraient être totalement interdits dans tous les établissements scolaires. » Quel est votre avis ?",
            "structure_hints": ["Position nette", "Argument pour : concentration et lutte contre le harcèlement", "Argument nuance : outil pédagogique moderne", "Exemple", "Conclusion"],
        },
        {
            "id": "t3_s4",
            "title": "Vivre en ville ou à la campagne",
            "prompt": "« Il est bien plus avantageux pour une famille d'habiter à la campagne que dans une métropole. » Partagez-vous cette opinion ?",
            "structure_hints": ["Votre avis", "Argument 1 : espace, calme et coût de la vie", "Argument 2 : accès aux services, santé et transports", "Exemple personnel", "Conclusion"],
        },
        {
            "id": "t3_s5",
            "title": "Le tourisme de masse",
            "prompt": "« Le tourisme de masse apporte plus d'inconvénients que d'avantages aux communautés locales. » Qu'en pensez-vous ?",
            "structure_hints": ["Prise de position", "Argument économique vs argument écologique", "Pression sur le logement et la vie quotidienne", "Exemple", "Conclusion"],
        },
        {
            "id": "t3_s6",
            "title": "La semaine de travail de 4 jours",
            "prompt": "« La semaine de 4 jours sans diminution de salaire est la solution d'avenir pour le monde du travail. » Partagez-vous cette affirmation ?",
            "structure_hints": ["Votre point de vue", "Argument productivité et santé mentale", "Argument faisabilité selon les secteurs", "Exemple", "Conclusion"],
        },
        {
            "id": "t3_s7",
            "title": "La publicité destinée aux enfants",
            "prompt": "« Les gouvernements devraient interdire toute publicité commerciale ciblant directement les enfants. » Êtes-vous d'accord ?",
            "structure_hints": ["Position", "Protection de la santé et des jeunes esprits", "Rôle de l'éducation familiale et des médias", "Exemple", "Conclusion"],
        },
        {
            "id": "t3_s8",
            "title": "L'avenir du livre papier",
            "prompt": "« Avec les livres numériques et les écrans, les livres papier sont condamnés à disparaître. » Quel est votre sentiment ?",
            "structure_hints": ["Votre thèse", "Avantages du numérique (praticité, volume)", "Valeur irremplaçable du papier (émotion, concentration)", "Exemple", "Conclusion"],
        },
        {
            "id": "t3_s9",
            "title": "L'intelligence artificielle et l'emploi",
            "prompt": "« Le développement rapide de l'intelligence artificielle va détruire plus d'emplois qu'il n'en créera. » Qu'en pensez-vous ?",
            "structure_hints": ["Position", "Menace pour les métiers répétitifs et intellectuels", "Création de nouvelles opportunités et complémentarité", "Exemple", "Conclusion"],
        },
        {
            "id": "t3_s10",
            "title": "Les repas végétariens dans les cantines",
            "prompt": "« Les cantines scolaires devraient proposer des repas entièrement végétariens plusieurs fois par semaine. » Partagez-vous cet avis ?",
            "structure_hints": ["Position claire", "Arguments environnementaux et de santé", "Respect des habitudes et liberté de choix", "Exemple", "Conclusion"],
        },
    ],
}


def word_count(text: str) -> int:
    cleaned = text.replace("'", " ").replace("’", " ")
    tokens = re.findall(r"[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*", cleaned)
    return len(tokens)


def calculate_wpm(words: int, duration_seconds: float) -> float:
    if duration_seconds <= 0:
        return 0.0
    return round((words / (duration_seconds / 60.0)), 1)


@contextmanager
def _db() -> Iterator[Any]:
    with auth_db.connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS speaking_attempts (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                task TEXT NOT NULL,
                subject_json TEXT NOT NULL DEFAULT '{}',
                level TEXT NOT NULL DEFAULT 'A1',
                status TEXT NOT NULL DEFAULT 'ready',
                transcript_1 TEXT NOT NULL DEFAULT '',
                feedback_1_json TEXT NOT NULL DEFAULT '{}',
                transcript_2 TEXT NOT NULL DEFAULT '',
                feedback_2_json TEXT NOT NULL DEFAULT '{}',
                seconds INTEGER NOT NULL DEFAULT 0,
                audio_duration REAL NOT NULL DEFAULT 0.0,
                wpm REAL NOT NULL DEFAULT 0.0,
                error TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        yield conn


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def create_attempt(
    user_id: int,
    task: str,
    subject: dict[str, Any],
    level: str,
    transcript_1: str,
    seconds: int,
    audio_duration: float,
) -> dict[str, Any]:
    attempt_id = uuid.uuid4().hex
    now = _now()
    words = word_count(transcript_1)
    wpm = calculate_wpm(words, audio_duration if audio_duration > 0 else seconds)
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO speaking_attempts (
                id, user_id, task, subject_json, level, status,
                transcript_1, feedback_1_json, transcript_2, feedback_2_json,
                seconds, audio_duration, wpm, error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'generating_1', ?, '{}', '', '{}', ?, ?, ?, '', ?, ?)
            """,
            (
                attempt_id,
                user_id,
                task,
                json.dumps(subject, ensure_ascii=False),
                level,
                transcript_1,
                seconds,
                audio_duration,
                wpm,
                now,
                now,
            ),
        )
    return get_attempt(user_id, attempt_id)


def update_attempt_round2(
    user_id: int, attempt_id: str, transcript_2: str, seconds: int, audio_duration: float
) -> dict[str, Any]:
    now = _now()
    words = word_count(transcript_2)
    wpm = calculate_wpm(words, audio_duration if audio_duration > 0 else seconds)
    with _db() as conn:
        conn.execute(
            """
            UPDATE speaking_attempts SET
                transcript_2 = ?,
                seconds = seconds + ?,
                audio_duration = CASE WHEN ? > 0 THEN ? ELSE audio_duration END,
                wpm = CASE WHEN ? > 0 THEN ? ELSE wpm END,
                status = 'generating_2',
                error = '',
                updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (transcript_2, max(0, seconds), audio_duration, audio_duration, wpm, wpm, now, attempt_id, user_id),
        )
    return get_attempt(user_id, attempt_id)


def set_attempt_feedback_1(attempt_id: str, feedback: dict[str, Any], error: str = "") -> None:
    now = _now()
    status = "failed" if error else "ready"
    with _db() as conn:
        conn.execute(
            """
            UPDATE speaking_attempts SET
                feedback_1_json = ?,
                status = ?,
                error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(feedback, ensure_ascii=False), status, error, now, attempt_id),
        )


def set_attempt_feedback_2(attempt_id: str, feedback: dict[str, Any], error: str = "") -> None:
    now = _now()
    status = "failed" if error else "ready"
    with _db() as conn:
        conn.execute(
            """
            UPDATE speaking_attempts SET
                feedback_2_json = ?,
                status = ?,
                error = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (json.dumps(feedback, ensure_ascii=False), status, error, now, attempt_id),
        )


def get_attempt(user_id: int, attempt_id: str) -> dict[str, Any] | None:
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM speaking_attempts WHERE id = ? AND user_id = ?",
            (attempt_id, user_id),
        ).fetchone()
        if not row:
            return None
        return _row_to_dict(row)


def list_attempts(user_id: int, limit: int = 30) -> list[dict[str, Any]]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM speaking_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]


def _row_to_dict(row: Any) -> dict[str, Any]:
    subject = {}
    feedback_1 = {}
    feedback_2 = {}
    try:
        subject = json.loads(row["subject_json"])
    except Exception:
        pass
    try:
        feedback_1 = json.loads(row["feedback_1_json"])
    except Exception:
        pass
    try:
        feedback_2 = json.loads(row["feedback_2_json"])
    except Exception:
        pass
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "task": row["task"],
        "subject": subject,
        "level": row["level"],
        "status": row["status"],
        "transcript_1": row["transcript_1"],
        "feedback_1": feedback_1,
        "transcript_2": row["transcript_2"],
        "feedback_2": feedback_2,
        "seconds": row["seconds"],
        "audio_duration": row["audio_duration"],
        "wpm": row["wpm"],
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ---------------------------------------------------------------------------
# T2 Role-play examiner AI reply
# ---------------------------------------------------------------------------


def build_roleplay_reply_payload(
    scenario: dict[str, Any], history: list[dict[str, str]], user_utterance: str, model: str
) -> dict[str, Any]:
    role = scenario.get("role_examiner") or "Vous êtes un employé sympathique et professionnel au Canada."
    prompt = scenario.get("prompt") or ""
    title = scenario.get("title") or ""

    system = (
        "Vous êtes l'examinateur dans l'épreuve d'expression orale TCF Canada (Tâche 2 : interaction).\n"
        f"Situation : {title}. {prompt}\n"
        f"Votre rôle : {role}\n"
        "Règles strictes :\n"
        "1. Répondez UNIQUEMENT en français naturel, chaleureux et court (1 à 2 phrases maximum, 15–25 mots).\n"
        "2. Donnez l'information demandée par le candidat.\n"
        "3. Ne posez pas de longue contre-question : c'est au candidat de mener l'échange et de poser les questions.\n"
        "4. Répondez directement, sans formule d'introduction métatextuelle."
    )

    messages = [{"role": "system", "content": system}]
    for turn in history[-6:]:
        messages.append({"role": turn.get("role", "user"), "content": turn.get("content", "")})
    messages.append({"role": "user", "content": user_utterance})

    return {
        "model": model,
        "messages": messages,
        "stream": False,
        "temperature": 0.4,
    }


def parse_roleplay_reply(raw_text: str) -> str:
    cleaned = raw_text.strip().strip('"').strip("'")
    return cleaned


# ---------------------------------------------------------------------------
# Feedback prompts and parsing
# ---------------------------------------------------------------------------

SPEAKING_TUTOR_RULES = (
    "You are an encouraging, expert French pronunciation and speaking coach for an adult A1-B2 learner preparing TCF Canada Expression Orale (EO).\n"
    "The learner is a native Chinese speaker with basic English.\n"
    "Crucial guidelines:\n"
    "- Write all explanations in simple, clear, direct English (max 12 words per sentence).\n"
    "- Chinese only in brackets [ ] for difficult terms.\n"
    "- Never predict or mention CEFR scores, TCF points, or NCLC levels.\n"
    "- The input text is a machine transcript generated by automated speech recognition (faster-whisper).\n"
    "  CRITICAL: Do NOT count obvious transcription artifacts, minor homophone phonetic spellings, or punctuation absence as learner errors.\n"
    "- Focus on genuine grammar, morphology, syntax, and question structures.\n"
    "- Never give whole model texts to memorize (recited texts receive 0 / A1 non atteint on TCF).\n"
)


def build_round1_payload(attempt: dict[str, Any], model: str) -> dict[str, Any]:
    task = attempt["task"]
    subject = attempt["subject"]
    transcript = attempt["transcript_1"]
    task_spec = TASKS.get(task, TASKS["T1"])
    duration = attempt.get("audio_duration") or attempt.get("seconds") or 0
    wpm = attempt.get("wpm") or calculate_wpm(word_count(transcript), duration)

    system = (
        f"{SPEAKING_TUTOR_RULES}\n"
        f"This is ROUND 1 speaking feedback for TCF EO {task} ({task_spec['name']}).\n"
        f"Situation: {subject.get('title', '')} - {subject.get('prompt', '')}\n"
        f"Speaking statistics: {duration} seconds duration, approx {wpm} words per minute (WPM).\n"
        "RULES FOR ROUND 1:\n"
        "1. DO NOT GIVE CORRECTIONS OR RECASTS IN ROUND 1! The learner will 'Say it again' in Round 2.\n"
        "2. Provide a task checklist check:\n"
        "   - For T1: personal details covered and response relevance.\n"
        "   - For T2: count how many questions were asked, and evaluate question syntax (inversion, 'est-ce que', intonation, question words: quel, combien, comment, etc.).\n"
        "   - For T3: evaluate speech structure (clear stance/opinion, 2 arguments, concrete example, conclusion).\n"
        "3. Identify up to 8 real spoken errors (the most important ones first).\n"
        "   Allowed types: agreement, verb form, gender, word order, spelling / accents, wrong word, missing word.\n"
        "   Provide ONLY a short guiding hint without giving the answers.\n"
        "4. Provide one praise point: one specific spoken phrase or expression used well.\n"
        "5. Provide speaking pace commentary based on WPM (target conversational rate: 80–120 WPM).\n"
        "Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "stats": {"duration_sec": int, "wpm": float, "pace_note": "string"},\n'
        '  "checklist": [{"point": "string", "covered": bool, "note": "string"}],\n'
        '  "t2_questions": {"count": int, "forms_ok": bool, "note": "string"} or null,\n'
        '  "t3_structure": {"opinion": bool, "arguments": bool, "example": bool, "conclusion": bool, "note": "string"} or null,\n'
        '  "praise": "string",\n'
        '  "errors": [\n'
        '    {"span": "exact substring from transcript", "type": "agreement|verb form|gender|word order|spelling / accents|wrong word|missing word", "hint": "short hint without answer"}\n'
        "  ]\n"
        "}"
    )

    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Here is my spoken transcript for {task}:\n\n{transcript}"},
        ],
        "stream": False,
        "temperature": 0,
    }


def parse_round1_feedback(
    raw_text: str, transcript_1: str, task: str, subject: dict[str, Any], duration: float, wpm: float
) -> dict[str, Any]:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    snippet = match.group(1) if match else raw_text.strip()
    try:
        data = json.loads(snippet)
    except Exception:
        start = snippet.find("{")
        end = snippet.rfind("}")
        if start != -1 and end != -1:
            data = json.loads(snippet[start : end + 1])
        else:
            raise ValueError(f"Could not parse speaking Round 1 JSON from LLM: {raw_text[:200]}")

    stats = data.get("stats") or {}
    stats["duration_sec"] = round(duration, 1)
    stats["wpm"] = round(wpm, 1)
    if not stats.get("pace_note"):
        if wpm < 70:
            stats["pace_note"] = f"{wpm} WPM · A bit slow, try linking words more smoothly."
        elif wpm > 130:
            stats["pace_note"] = f"{wpm} WPM · Fast pace! Take your time to articulate clearly."
        else:
            stats["pace_note"] = f"{wpm} WPM · Great natural speaking rhythm."

    checklist = []
    for item in data.get("checklist") or []:
        checklist.append({
            "point": str(item.get("point") or ""),
            "covered": bool(item.get("covered", False)),
            "note": str(item.get("note") or ""),
        })

    t2_q = data.get("t2_questions")
    t2_questions = None
    if task == "T2" and isinstance(t2_q, dict):
        t2_questions = {
            "count": int(t2_q.get("count", 0)),
            "forms_ok": bool(t2_q.get("forms_ok", False)),
            "note": str(t2_q.get("note") or ""),
        }

    t3_s = data.get("t3_structure")
    t3_structure = None
    if task == "T3" and isinstance(t3_s, dict):
        t3_structure = {
            "opinion": bool(t3_s.get("opinion", False)),
            "arguments": bool(t3_s.get("arguments", False)),
            "example": bool(t3_s.get("example", False)),
            "conclusion": bool(t3_s.get("conclusion", False)),
            "note": str(t3_s.get("note") or ""),
        }

    raw_errors = data.get("errors") or []
    cleaned_errors = []
    forbidden_leak = re.compile(r"(?:change\s+to|replace\s+with|should\s+be|write|say|correct\s+form\s+is)\s+['\"]?([^,.;'\"]+)", re.IGNORECASE)
    for err in raw_errors[:8]:
        span = str(err.get("span") or "").strip()
        etype = str(err.get("type") or "wrong word").lower()
        if etype not in ALLOWED_ERROR_TYPES:
            etype = "wrong word"
        hint = str(err.get("hint") or "Check this part carefully.").strip()
        if forbidden_leak.search(hint):
            hint = f"Check the {etype} here carefully."
        cleaned_errors.append({
            "span": span,
            "type": etype,
            "hint": hint,
        })

    return {
        "stats": stats,
        "checklist": checklist,
        "t2_questions": t2_questions,
        "t3_structure": t3_structure,
        "praise": str(data.get("praise") or "Great oral effort!"),
        "errors": cleaned_errors,
    }


def build_round2_payload(attempt: dict[str, Any], model: str) -> dict[str, Any]:
    task = attempt["task"]
    subject = attempt["subject"]
    transcript_1 = attempt["transcript_1"]
    feedback_1 = attempt.get("feedback_1") or {}
    errors_1 = feedback_1.get("errors") or []
    transcript_2 = attempt["transcript_2"]
    task_spec = TASKS.get(task, TASKS["T1"])

    errors_summary = "\n".join(
        [f"- Error: '{e.get('span')}' ({e.get('type')}): hint was '{e.get('hint')}'" for e in errors_1]
    )

    system = (
        f"{SPEAKING_TUTOR_RULES}\n"
        f"This is ROUND 2 speaking feedback for TCF EO {task} ({task_spec['name']}).\n"
        "The learner practiced and said it again (or revised their speech).\n"
        f"First recording transcript (Round 1):\n{transcript_1}\n\n"
        f"Round 1 errors to check:\n{errors_summary or '(none)'}\n\n"
        "RULES FOR ROUND 2:\n"
        "1. Check which Round 1 errors the learner successfully fixed, and which remain.\n"
        "2. Provide a minimally corrected version of the learner's own spoken sentences.\n"
        "   CRUCIAL: Do NOT write a new model text. Preserve the learner's own thoughts.\n"
        "3. Break the corrected version into sentences. For each sentence, provide:\n"
        "   - original: sentence as transcribed from learner\n"
        "   - corrected: minimally corrected spoken French sentence\n"
        "   - explanation: short English note on what was corrected\n"
        "   - chunk: the specific corrected French phrase/target for an Anki card\n"
        "4. List at most 3 reusable spoken structures suitable for this task (e.g. 'Est-ce que vous pourriez me dire si…').\n"
        "   Clearly label them as grammar structures, not texts to memorize.\n"
        "Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "fixed_errors": [{"span": "string", "fixed": bool, "comment": "string"}],\n'
        '  "remaining_errors": [{"span": "string", "type": "string", "hint": "string", "correction": "string"}],\n'
        '  "corrected_transcript": "full minimally corrected French transcript",\n'
        '  "sentences": [\n'
        '    {"original": "string", "corrected": "string", "explanation": "string", "chunk": "corrected phrase"}\n'
        "  ],\n"
        '  "structures": [\n'
        '    {"french": "string", "english": "string", "usage": "string"}\n'
        "  ]\n"
        "}"
    )

    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Here is my revised spoken transcript (Round 2):\n\n{transcript_2}"},
        ],
        "stream": False,
        "temperature": 0,
    }


def parse_round2_feedback(raw_text: str) -> dict[str, Any]:
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    snippet = match.group(1) if match else raw_text.strip()
    try:
        data = json.loads(snippet)
    except Exception:
        start = snippet.find("{")
        end = snippet.rfind("}")
        if start != -1 and end != -1:
            data = json.loads(snippet[start : end + 1])
        else:
            raise ValueError(f"Could not parse speaking Round 2 JSON from LLM: {raw_text[:200]}")

    fixed_errors = []
    for item in data.get("fixed_errors") or []:
        fixed_errors.append({
            "span": str(item.get("span") or ""),
            "fixed": bool(item.get("fixed", False)),
            "comment": str(item.get("comment") or ""),
        })

    remaining_errors = []
    for item in data.get("remaining_errors") or []:
        remaining_errors.append({
            "span": str(item.get("span") or ""),
            "type": str(item.get("type") or "wrong word"),
            "hint": str(item.get("hint") or ""),
            "correction": str(item.get("correction") or ""),
        })

    sentences = []
    for s in data.get("sentences") or []:
        corr = str(s.get("corrected") or "").strip()
        orig = str(s.get("original") or "").strip()
        chunk = str(s.get("chunk") or "").strip()
        if not chunk and corr:
            chunk = corr
        if corr:
            sentences.append({
                "original": orig,
                "corrected": corr,
                "explanation": str(s.get("explanation") or ""),
                "chunk": chunk,
            })

    structures = []
    for st in (data.get("structures") or [])[:3]:
        structures.append({
            "french": str(st.get("french") or ""),
            "english": str(st.get("english") or ""),
            "usage": str(st.get("usage") or ""),
        })

    return {
        "fixed_errors": fixed_errors,
        "remaining_errors": remaining_errors,
        "corrected_transcript": str(data.get("corrected_transcript") or ""),
        "sentences": sentences,
        "structures": structures,
    }