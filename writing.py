"""
French Audio Studio - Writing practice for TCF Canada Expression Écrite (EE).

Tasks:
  - T1: Message / courriel (60-120 words, 10 min)
  - T2: Récit d'une expérience / article (120-150 words, 20 min)
  - T3: Comparaison (40-60 words) + opinion personnelle (80-120 words), 30 min

Feedback follows a two-round guided structure:
  - Round 1: Task checklist, one thing done well, and up to 8 error hints
             (NO direct corrections given in round 1!).
  - Round 2: Fixed errors report, minimally corrected text with card targets,
             and up to 3 reusable structures (not text to memorize).
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
        "name": "Tâche 1 : Message / courriel",
        "name_en": "Task 1: Message / email",
        "desc": "Écrire un message ou courriel amical ou professionnel (60–120 mots).",
        "desc_en": "Write a friendly or professional message/email (60–120 words).",
        "min_words": 60,
        "max_words": 120,
        "timer_seconds": 600,
        "recommended_levels": ("A1", "A2"),
    },
    "T2": {
        "id": "T2",
        "name": "Tâche 2 : Récit d'une expérience / article",
        "name_en": "Task 2: Experience story / article",
        "desc": "Raconter une expérience personnelle ou un événement marquant (120–150 mots).",
        "desc_en": "Share a personal experience, event or article (120–150 words).",
        "min_words": 120,
        "max_words": 150,
        "timer_seconds": 1200,
        "recommended_levels": ("B1",),
    },
    "T3": {
        "id": "T3",
        "name": "Tâche 3 : Comparaison et prise de position",
        "name_en": "Task 3: Comparison and opinion",
        "desc": "Comparer deux textes d'opinion (40–60 mots), puis exprimer et justifier votre position (80–120 mots).",
        "desc_en": "Compare two opinion texts (40–60 words), then state and justify your own position (80–120 words).",
        "min_words": 120,
        "max_words": 180,
        "part1_range": "40–60",
        "part2_range": "80–120",
        "timer_seconds": 1800,
        "recommended_levels": ("B2",),
    },
}

SUBJECTS: dict[str, list[dict[str, Any]]] = {
    "T1": [
        {
            "id": "t1_1",
            "title": "Invitation à un dîner de crémaillère",
            "prompt": "Vous venez d'emménager dans un nouvel appartement à Montréal. Vous écrivez un courriel à vos collègues pour les inviter à un dîner vendredi prochain chez vous.",
            "requirements": ["Expliquer la raison de l'invitation", "Indiquer la date, l'heure et l'adresse", "Demander de confirmer la présence avant mercredi"],
        },
        {
            "id": "t1_2",
            "title": "Demande de service à un voisin",
            "prompt": "Vous partez en vacances pendant dix jours. Écrivez un message à votre voisin pour lui demander de surveiller vos plantes et votre courrier.",
            "requirements": ["Expliquer vos dates d'absence", "Préciser les deux services demandés", "Laisser vos coordonnées en cas d'urgence"],
        },
        {
            "id": "t1_3",
            "title": "Annulation d'un rendez-vous médical",
            "prompt": "Vous avez un rendez-vous chez le dentiste à Ottawa mardi à 14h, mais vous avez un empêchement professionnel imprévu.",
            "requirements": ["Expliquer poliment le motif de l'annulation", "S'excuser pour le désagrément", "Demander un autre créneau la semaine suivante"],
        },
        {
            "id": "t1_4",
            "title": "Remerciements après un déménagement",
            "prompt": "Un ami vous a aidé tout le week-end pour votre déménagement. Écrivez-lui un mot chaleureux.",
            "requirements": ["Le remercier pour son aide précieuse", "Dire que vous êtes bien installé", "L'inviter au restaurant pour fêter ça"],
        },
        {
            "id": "t1_5",
            "title": "Absence à la garderie",
            "prompt": "Votre enfant est malade et ne pourra pas aller à la garderie pendant deux jours. Vous écrivez à la responsable.",
            "requirements": ["Indiquer le nom de l'enfant et les jours d'absence", "Expliquer brièvement la raison", "Préciser la date prévue de son retour"],
        },
        {
            "id": "t1_6",
            "title": "Signalement d'une fuite d'eau",
            "prompt": "Une fuite d'eau s'est déclarée sous l'évier de votre cuisine. Vous écrivez au gestionnaire de votre immeuble.",
            "requirements": ["Décrire le problème et son urgence", "Indiquer vos disponibilités pour un réparateur", "Demander une réponse rapide"],
        },
        {
            "id": "t1_7",
            "title": "Inscription à un club de randonnée",
            "prompt": "Vous souhaitez rejoindre un club de plein air à Québec. Écrivez un courriel au responsable du club.",
            "requirements": ["Présenter votre niveau de marche et votre intérêt", "Poser deux questions sur le calendrier des sorties et l'équipement", "Demander comment finaliser l'inscription"],
        },
        {
            "id": "t1_8",
            "title": "Organisation d'un anniversaire surprise",
            "prompt": "Vous organisez une fête surprise pour les 30 ans d'un ami proche. Écrivez aux invités.",
            "requirements": ["Donner la date, l'heure et le lieu secret", "Demander de garder le secret absolu", "Proposer d'apporter quelque chose à partager"],
        },
        {
            "id": "t1_9",
            "title": "Carte de bibliothèque égarée",
            "prompt": "Vous avez perdu votre carte d'abonné à la bibliothèque municipale. Vous écrivez à l'accueil.",
            "requirements": ["Expliquer la perte de votre carte", "Demander la démarche pour en obtenir une nouvelle", "Vérifier si vous avez des emprunts en cours"],
        },
        {
            "id": "t1_10",
            "title": "Départ d'un collègue",
            "prompt": "Un collègue proche quitte l'équipe pour un nouveau projet. Écrivez-lui un message d'adieu amical.",
            "requirements": ["Rappeler un bon souvenir de travail commun", "Lui souhaiter plein succès dans sa nouvelle aventure", "Proposer de rester en contact"],
        },
    ],
    "T2": [
        {
            "id": "t2_1",
            "title": "Mon premier mois au Canada",
            "prompt": "Racontez pour le blog des nouveaux arrivants votre premier mois dans une ville canadienne : vos surprises, vos découvertes et vos premiers défis.",
            "requirements": ["Décrire votre arrivée et vos premières impressions", "Raconter une difficulté rencontrée et comment vous l'avez surmontée", "Donner un conseil utile à ceux qui arrivent bientôt"],
        },
        {
            "id": "t2_2",
            "title": "Une fête ou un festival inoubliable",
            "prompt": "Vous avez assisté à un événement culturel ou un festival local (ex. Carnaval d'hiver de Québec). Racontez votre expérience.",
            "requirements": ["Présenter l'événement et l'ambiance générale", "Décrire un moment précis qui vous a marqué", "Expliquer pourquoi vous recommandez cette fête"],
        },
        {
            "id": "t2_3",
            "title": "Un voyage qui ne s'est pas passé comme prévu",
            "prompt": "Racontez une excursion ou un voyage où rien ne s'est déroulé selon le plan initial.",
            "requirements": ["Situer le contexte de départ", "Raconter les imprévus survenus et vos réactions", "Tirer une conclusion positive ou une leçon de cette aventure"],
        },
        {
            "id": "t2_4",
            "title": "Un an de télétravail : mon bilan",
            "prompt": "Écrivez un article pour le journal interne de votre entreprise après avoir passé un an en travail à distance.",
            "requirements": ["Présenter comment votre quotidien a changé", "Analyser les avantages et les inconvénients majeurs", "Proposer des conseils pour mieux concilier vie privée et travail"],
        },
        {
            "id": "t2_5",
            "title": "Mon engagement bénévole dans le quartier",
            "prompt": "Vous avez participé à une action d'entraide ou de bénévolat (banque alimentaire, nettoyage d'un parc). Partagez votre vécu.",
            "requirements": ["Expliquer ce qui vous a motivé à vous engager", "Décrire vos tâches et les rencontres faites", "Expliquer ce que cette expérience vous a apporté sur le plan personnel"],
        },
        {
            "id": "t2_6",
            "title": "L'apprentissage d'une nouvelle passion",
            "prompt": "Racontez comment vous vous êtes lancé dans un nouveau sport, un instrument de musique ou une compétence.",
            "requirements": ["Décrire les débuts et les doutes initiaux", "Raconter une étape clé où vous avez senti un progrès", "Exprimer vos objectifs futurs pour cette activité"],
        },
        {
            "id": "t2_7",
            "title": "Un coin de nature remarquable",
            "prompt": "Rédigez pour un guide de voyage le récit de votre visite dans un parc national ou un lieu naturel exceptionnel.",
            "requirements": ["Décrire le paysage, les saisons et les sensations éprouvées", "Raconter une randonnée particulière", "Expliquer pourquoi cet endroit est unique"],
        },
        {
            "id": "t2_8",
            "title": "L'arrivée d'un animal de compagnie chez moi",
            "prompt": "Racontez l'adoption d'un chien ou d'un chat et les changements intervenus dans votre foyer.",
            "requirements": ["Expliquer les circonstances de l'adoption", "Décrire les premières semaines d'adaptation", "Expliquer en quoi votre mode de vie a été transformé"],
        },
        {
            "id": "t2_9",
            "title": "Compte-rendu d'une formation professionnelle",
            "prompt": "Vous venez de suivre une formation de trois jours très enrichissante. Partagez votre retour d'expérience avec vos pairs.",
            "requirements": ["Présenter les thèmes abordés", "Décrire un atelier pratique particulièrement utile", "Expliquer comment vous allez appliquer ces acquis dans votre travail"],
        },
        {
            "id": "t2_10",
            "title": "Un défi sportif relevé avec fierté",
            "prompt": "Racontez votre participation à une épreuve sportive (course de 10 km, sortie en canot, randonnée en raquettes).",
            "requirements": ["Décrire la préparation physique et mentale", "Raconter le déroulement de l'épreuve et les moments difficiles", "Exprimer votre sentiment à l'arrivée"],
        },
    ],
    "T3": [
        {
            "id": "t3_1",
            "title": "Le travail à distance généralisé",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Le télétravail représente une véritable avancée sociale et écologique. En supprimant les temps de transport quotidiens, il réduit le stress et l'empreinte carbone des salariés tout en favorisant un meilleur équilibre entre vie professionnelle et vie de famille. La productivité s'en trouve accrue et l'autonomie des équipes renforcée.",
            "doc2": "La généralisation du travail à domicile détruit la cohésion d'équipe et fragilise le lien social. De nombreux employés souffrent d'isolement et peinent à déconnecter le soir, ce qui augmente le risque de burn-out. De plus, l'absence de contact informel au bureau nuit à la créativité et à l'intégration des nouvelles recrues.",
        },
        {
            "id": "t3_2",
            "title": "La gratuité des transports en commun",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Rendre les transports publics entièrement gratuits est la mesure la plus efficace pour lutter contre la crise climatique. Cela incite immédiatement les automobilistes à laisser leur voiture au garage, réduit les embouteillages en ville et offre une aide précieuse aux ménages les plus modestes.",
            "doc2": "La gratuité est un leurre économique coûteux qui dégrade la qualité des services. Privés de recettes d'abonnements, les réseaux de transport manquent cruellement de moyens pour entretenir les rames, étendre les lignes ou assurer la sécurité des passagers. Une tarification solidaire ciblée est bien plus responsable.",
        },
        {
            "id": "t3_3",
            "title": "Les trottinettes électriques en libre-service",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Les trottinettes électriques offrent une solution idéale pour les petits trajets urbains du dernier kilomètre. Silencieuses, rapides et faciles à réserver via une application, elles désengorgent les centres-villes et complètent parfaitement le métro ou le bus sans polluer.",
            "doc2": "L'invasion des trottinettes en libre-service transforme les trottoirs en véritables zones dangereuses. Abandonnées n'importe où, elles bloquent les piétons et les personnes à mobilité réduite. De plus, la multiplication des accidents graves et la faible durée de vie des batteries posent de graves problèmes écologiques.",
        },
        {
            "id": "t3_4",
            "title": "L'interdiction des téléphones portables à l'école",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Bannir les smartphones des établissements scolaires est indispensable pour protéger l'attention des élèves et freiner le cyberharcèlement. Sans écran dans la cour et en classe, les jeunes discutent davantage entre eux, font plus de sport et se concentrent mieux sur leurs apprentissages fondamentaux.",
            "doc2": "Interdire les téléphones est une mesure passéiste qui ignore la réalité du monde moderne. L'école a plutôt pour mission d'apprendre aux jeunes à utiliser le numérique avec discernement. Les smartphones constituent par ailleurs des outils pédagogiques formidables pour faire des recherches interactives en classe.",
        },
        {
            "id": "t3_5",
            "title": "La semaine de travail de 4 jours",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Passer à 4 jours de travail sans baisse de salaire améliore considérablement le bien-être des travailleurs et réduit l'absentéisme. Reposés, les employés sont plus motivés et concentrés durant leurs heures de travail. C'est également une formidable opportunité pour revitaliser la vie associative et familiale.",
            "doc2": "La semaine de 4 jours est inapplicable dans la majorité des secteurs en tension comme la santé, la restauration ou l'artisanat. Elle concentre trop d'heures sur peu de journées, ce qui engendre une fatigue accrue. Pour les petites entreprises, cela entraînerait des coûts d'embauche insupportables.",
        },
        {
            "id": "t3_6",
            "title": "La disparition de l'argent liquide",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Une société 100% numérique et sans monnaie physique est plus sûre, plus propre et plus rapide. Les paiements électroniques réduisent drastiquement les risques de vol à main armée, simplifient la comptabilité des commerçants et permettent de combattre efficacement la fraude fiscale et le travail au noir.",
            "doc2": "Supprimer les billets et les pièces menace nos libertés individuelles en permettant aux banques et aux États de tracer chacune de nos dépenses. De plus, cela exclut les personnes âgées, les sans-abri et les plus précaires qui n'ont pas accès aux outils technologiques ou aux comptes bancaires.",
        },
        {
            "id": "t3_7",
            "title": "L'accès réglementé aux parcs naturels",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Instaurer des quotas et des réservations obligatoires est le seul moyen de sauver nos écosystèmes fragiles face au tourisme de masse. La faune sauvage a besoin de quiétude et les sentiers surfréquentés se dégradent à vue d'œil. La préservation de la biodiversité doit primer sur le loisir immédiat.",
            "doc2": "La nature doit rester un bien commun accessible à tous sans barrière administrative ni tirage au sort. Réserver des mois à l'avance empêche toute sortie spontanée et favorise ceux qui maîtrisent l'informatique. Il vaut mieux sensibiliser les visiteurs et aménager durablement les sites plutôt que d'en fermer les portes.",
        },
        {
            "id": "t3_8",
            "title": "La régulation des locations de courte durée",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Les plateformes touristiques permettent à des milliers d'habitants de compléter leurs revenus pour faire face à l'inflation et d'accueillir des visiteurs dans des quartiers authentiques. C'est un moteur économique vital pour les commerces locaux qui stimule le dynamisme des villes.",
            "doc2": "La prolifération des logements touristiques crée une pénurie catastrophique d'habitations pour les résidents permanents et fait flamber les loyers. Les centres-villes perdent leur vie de quartier au profit d'immeubles transformés en hôtels clandestins sans surveillance.",
        },
        {
            "id": "t3_9",
            "title": "L'intelligence artificielle à l'université",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "L'intelligence artificielle offre un tuteur personnalisé accessible 24h/24 pour expliquer des concepts complexes, traduire des articles scientifiques et corriger le code ou la syntaxe. Elle démocratise le savoir et prépare les étudiants aux compétences indispensables du marché du travail.",
            "doc2": "L'usage généralisé de l'IA menace l'apprentissage de la réflexion critique et de la rédaction autonome. Si les étudiants délèguent leurs devoirs et leurs dissertations à des algorithmes, ils perdront leur capacité à formuler une pensée originale et à surmonter les difficultés intellectuelles.",
        },
        {
            "id": "t3_10",
            "title": "Le vote obligatoire",
            "prompt": "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
            "doc1": "Rendre le vote obligatoire renforce la légitimité des élus et garantit que toutes les classes sociales soient représentées dans les urnes. Voter n'est pas seulement un droit, c'est un devoir civique qui oblige les citoyens à s'intéresser aux enjeux de leur collectivité.",
            "doc2": "La liberté de voter implique obligatoirement la liberté de s'abstenir ou de refuser de choisir des candidats qui ne nous représentent pas. Forcer des citoyens désintéressés à voter conduit à des choix hasardeux ou de protestation aveugle, sans améliorer en rien la qualité du débat démocratique.",
        },
    ],
}


def word_count(text: str) -> int:
    """Count words following French TCF testing practice.
    Apostrophes split clitics (j'ai -> 2 words, l'arbre -> 2 words).
    Hyphenated words count as separate chunks if compound.
    """
    cleaned = text.replace("'", " ").replace("’", " ")
    tokens = re.findall(r"[a-zA-ZÀ-ÿ0-9]+(?:-[a-zA-ZÀ-ÿ0-9]+)*", cleaned)
    return len(tokens)


@contextmanager
def _db() -> Iterator[Any]:
    with auth_db.connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS writing_attempts (
                id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                task TEXT NOT NULL,
                subject_json TEXT NOT NULL DEFAULT '{}',
                level TEXT NOT NULL DEFAULT 'A1',
                status TEXT NOT NULL DEFAULT 'ready',
                text_1 TEXT NOT NULL DEFAULT '',
                feedback_1_json TEXT NOT NULL DEFAULT '{}',
                text_2 TEXT NOT NULL DEFAULT '',
                feedback_2_json TEXT NOT NULL DEFAULT '{}',
                seconds INTEGER NOT NULL DEFAULT 0,
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
    user_id: int, task: str, subject: dict[str, Any], level: str, text_1: str, seconds: int
) -> dict[str, Any]:
    attempt_id = uuid.uuid4().hex
    now = _now()
    with _db() as conn:
        conn.execute(
            """
            INSERT INTO writing_attempts (
                id, user_id, task, subject_json, level, status,
                text_1, feedback_1_json, text_2, feedback_2_json,
                seconds, error, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'generating_1', ?, '{}', '', '{}', ?, '', ?, ?)
            """,
            (attempt_id, user_id, task, json.dumps(subject, ensure_ascii=False), level, text_1, seconds, now, now),
        )
    return get_attempt(user_id, attempt_id)


def update_attempt_round2(
    user_id: int, attempt_id: str, text_2: str, seconds: int
) -> dict[str, Any]:
    now = _now()
    with _db() as conn:
        conn.execute(
            """
            UPDATE writing_attempts SET
                text_2 = ?,
                seconds = seconds + ?,
                status = 'generating_2',
                error = '',
                updated_at = ?
            WHERE id = ? AND user_id = ?
            """,
            (text_2, max(0, seconds), now, attempt_id, user_id),
        )
    return get_attempt(user_id, attempt_id)


def set_attempt_feedback_1(attempt_id: str, feedback: dict[str, Any], error: str = "") -> None:
    now = _now()
    status = "failed" if error else "ready"
    with _db() as conn:
        conn.execute(
            """
            UPDATE writing_attempts SET
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
            UPDATE writing_attempts SET
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
            "SELECT * FROM writing_attempts WHERE id = ? AND user_id = ?",
            (attempt_id, user_id),
        ).fetchone()
        if not row:
            return None
        return _row_to_dict(row)


def list_attempts(user_id: int, limit: int = 30) -> list[dict[str, Any]]:
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM writing_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
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
        "text_1": row["text_1"],
        "feedback_1": feedback_1,
        "text_2": row["text_2"],
        "feedback_2": feedback_2,
        "seconds": row["seconds"],
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ---------------------------------------------------------------------------
# Prompt generation and parsing
# ---------------------------------------------------------------------------

TUTOR_RULES = (
    "You are an encouraging, expert French language tutor for an adult A1-B2 learner preparing TCF Canada Expression Écrite.\n"
    "The learner is a native Chinese speaker with basic English.\n"
    "Crucial guidelines:\n"
    "- Write all explanations in simple, clear, direct English (short sentences, max 12 words per sentence).\n"
    "- Chinese only in brackets [ ] for difficult terms.\n"
    "- Never predict or mention CEFR scores, TCF points, or NCLC levels.\n"
    "- Feedback must strictly be: task checklist + praise + actionable error hints.\n"
    "- Never give whole model texts to memorize (recited texts receive 0 / A1 non atteint on TCF).\n"
)


def build_round1_payload(attempt: dict[str, Any], model: str) -> dict[str, Any]:
    task = attempt["task"]
    subject = attempt["subject"]
    text = attempt["text_1"]
    task_spec = TASKS.get(task, TASKS["T1"])
    min_w = task_spec["min_words"]
    max_w = task_spec["max_words"]

    doc_context = ""
    if task == "T3":
        doc_context = (
            f"Document 1: {subject.get('doc1', '')}\n"
            f"Document 2: {subject.get('doc2', '')}\n"
        )

    system = (
        f"{TUTOR_RULES}\n"
        f"This is ROUND 1 feedback for TCF EE {task} ({task_spec['name']}).\n"
        f"Task word range: {min_w}–{max_w} words.\n"
        "Requirements of the subject:\n"
        f"Subject Title: {subject.get('title', '')}\n"
        f"Prompt: {subject.get('prompt', '')}\n"
        f"Points/requirements: {', '.join(subject.get('requirements', []))}\n"
        f"{doc_context}\n"
        "RULES FOR ROUND 1:\n"
        "1. DO NOT GIVE CORRECTIONS OR RECASTS IN ROUND 1! The learner must fix errors themselves in Round 2.\n"
        "2. Identify up to 8 error spans (the most important ones first).\n"
        "3. Allowed error types: agreement, verb form, gender, word order, spelling / accents, wrong word, missing word.\n"
        "4. For each error span, provide ONLY a short guiding hint that helps the learner spot the rule without revealing the answer.\n"
        "   GOOD hint: 'Check the plural agreement of this adjective.'\n"
        "   GOOD hint: 'Which auxiliary verb is needed with this movement verb in passé composé?'\n"
        "   BAD hint (FORBIDDEN): 'Change aller to suis allé.' (Reveals the answer!).\n"
        "5. Provide one praise point: one specific phrase or idea the learner expressed well.\n"
        "6. Provide a task checklist check (word count, required points covered, register tu vs vous, for T3 comparison and position).\n"
        "Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "word_count": {"actual": int, "min": int, "max": int, "in_range": bool, "note": "string"},\n'
        '  "checklist": [{"point": "string", "covered": bool, "note": "string"}],\n'
        '  "register": {"choice": "vous|tu", "fits": bool, "note": "string"},\n'
        '  "t3_comparison": {"compared": bool, "position_clear": bool, "note": "string"} or null,\n'
        '  "praise": "string",\n'
        '  "errors": [\n'
        '    {"span": "exact substring from learner text", "type": "agreement|verb form|gender|word order|spelling / accents|wrong word|missing word", "hint": "short hint without answer"}\n'
        "  ]\n"
        "}"
    )

    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Here is my text for {task}:\n\n{text}"},
        ],
        "stream": False,
        "temperature": 0,
    }


def parse_round1_feedback(
    raw_text: str, text_1: str, task: str, subject: dict[str, Any]
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
            raise ValueError(f"Could not parse Round 1 JSON from LLM: {raw_text[:200]}")

    actual_wc = word_count(text_1)
    task_spec = TASKS.get(task, TASKS["T1"])
    min_w = task_spec["min_words"]
    max_w = task_spec["max_words"]

    wc = data.get("word_count") or {}
    wc["actual"] = actual_wc
    wc["min"] = min_w
    wc["max"] = max_w
    wc["in_range"] = (min_w <= actual_wc <= max_w)
    if not wc.get("note"):
        if actual_wc < min_w:
            wc["note"] = f"{actual_wc} words ({min_w - actual_wc} words under minimum of {min_w})."
        elif actual_wc > max_w:
            wc["note"] = f"{actual_wc} words ({actual_wc - max_w} words over maximum of {max_w})."
        else:
            wc["note"] = f"{actual_wc} words (in target range {min_w}–{max_w})."

    checklist = []
    for item in data.get("checklist") or []:
        checklist.append({
            "point": str(item.get("point") or ""),
            "covered": bool(item.get("covered", False)),
            "note": str(item.get("note") or ""),
        })

    reg = data.get("register") or {}
    register = {
        "choice": str(reg.get("choice") or "vous"),
        "fits": bool(reg.get("fits", True)),
        "note": str(reg.get("note") or ""),
    }

    t3_comp = data.get("t3_comparison")
    if task == "T3" and isinstance(t3_comp, dict):
        t3_comparison = {
            "compared": bool(t3_comp.get("compared", False)),
            "position_clear": bool(t3_comp.get("position_clear", False)),
            "note": str(t3_comp.get("note") or ""),
        }
    else:
        t3_comparison = None

    raw_errors = data.get("errors") or []
    cleaned_errors = []
    forbidden_leak = re.compile(
        r"(?:change\s+to|replace\s+with|should\s+be|write\s+['\"]|write\s+|correct\s+form\s+is)\s+([^,.;]+)",
        re.IGNORECASE,
    )
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
        "word_count": wc,
        "checklist": checklist,
        "register": register,
        "t3_comparison": t3_comparison,
        "praise": str(data.get("praise") or "Good effort tackling this task!"),
        "errors": cleaned_errors,
    }


def build_round2_payload(attempt: dict[str, Any], model: str) -> dict[str, Any]:
    task = attempt["task"]
    subject = attempt["subject"]
    text_1 = attempt["text_1"]
    feedback_1 = attempt.get("feedback_1") or {}
    errors_1 = feedback_1.get("errors") or []
    text_2 = attempt["text_2"]
    task_spec = TASKS.get(task, TASKS["T1"])

    errors_summary = "\n".join(
        [f"- Error: '{e.get('span')}' ({e.get('type')}): hint was '{e.get('hint')}'" for e in errors_1]
    )

    system = (
        f"{TUTOR_RULES}\n"
        f"This is ROUND 2 feedback for TCF EE {task} ({task_spec['name']}).\n"
        "The learner read Round 1 error hints and has revised their text.\n"
        f"Original text (Round 1):\n{text_1}\n\n"
        f"Round 1 errors to check:\n{errors_summary or '(none)'}\n\n"
        "RULES FOR ROUND 2:\n"
        "1. Check which Round 1 errors the learner successfully fixed, and which remain.\n"
        "2. Provide a minimally corrected version of the learner's own revised text.\n"
        "   CRUCIAL: Do NOT write a new model text. Preserve the learner's own ideas and structure.\n"
        "3. Break the corrected version into sentences. For each sentence, provide:\n"
        "   - original: sentence as learner wrote it in round 2\n"
        "   - corrected: minimally corrected French sentence\n"
        "   - explanation: short English note on what was fixed\n"
        "   - chunk: the specific corrected French phrase/target for an Anki card\n"
        "4. List at most 3 reusable structures from this task (e.g. 'Je vous écris pour + infinitif').\n"
        "   Clearly label them as grammar structures, not full texts to memorize.\n"
        "Return ONLY valid JSON matching this schema:\n"
        "{\n"
        '  "fixed_errors": [{"span": "string", "fixed": bool, "comment": "string"}],\n'
        '  "remaining_errors": [{"span": "string", "type": "string", "hint": "string", "correction": "string"}],\n'
        '  "corrected_text": "full minimally corrected French text",\n'
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
            {"role": "user", "content": f"Here is my revised text (Round 2):\n\n{text_2}"},
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
            raise ValueError(f"Could not parse Round 2 JSON from LLM: {raw_text[:200]}")

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
        "corrected_text": str(data.get("corrected_text") or ""),
        "sentences": sentences,
        "structures": structures,
    }


def build_new_subject_payload(
    task: str, level: str = "A1", theme: str = "", model: str = "gemini-3.8-flash"
) -> dict[str, Any]:
    task_spec = TASKS.get(task, TASKS["T1"])
    prompt_theme = f"on the topic of '{theme}'" if theme else "on everyday Canadian or French life"
    extra_req = ""
    if task == "T3":
        extra_req = (
            "Provide two contrasting documents (doc1 and doc2), each around 70–90 words, "
            "presenting opposite viewpoints on an everyday social topic in Canada/France."
        )

    system = (
        "You create authentic TCF Canada Expression Écrite test subjects.\n"
        f"Generate a brand new subject for {task} ({task_spec['name']}) {prompt_theme}.\n"
        f"{extra_req}\n"
        "Return ONLY valid JSON with keys:\n"
        '{\n'
        '  "title": "Short title in French",\n'
        '  "prompt": "Clear situation prompt in French",\n'
        '  "requirements": ["point 1 in French", "point 2 in French", "point 3 in French"],\n'
        '  "doc1": "Document 1 in French (~80 words, for T3 only, empty string otherwise)",\n'
        '  "doc2": "Document 2 in French (~80 words, for T3 only, empty string otherwise)"\n'
        '}'
    )
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Create one realistic TCF Canada {task} prompt now."},
        ],
        "stream": False,
        "temperature": 0.4,
    }


def parse_new_subject(raw_text: str, task: str) -> dict[str, Any]:
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
            raise ValueError(f"Could not parse subject JSON from LLM: {raw_text[:200]}")

    sub_id = f"{task.lower()}_custom_{uuid.uuid4().hex[:8]}"
    return {
        "id": sub_id,
        "task": task,
        "title": str(data.get("title") or "Sujet d'entraînement"),
        "prompt": str(data.get("prompt") or ""),
        "requirements": [str(r) for r in data.get("requirements") or []],
        "doc1": str(data.get("doc1") or ""),
        "doc2": str(data.get("doc2") or ""),
    }
