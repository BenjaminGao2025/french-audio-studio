// Payloads captured from the real FastAPI backend (python run against a temporary OUTPUT_DIR),
// trimmed to one subject per task. The comment above each export names the code that builds it.
// These are not mock data: they pin the shapes src/api/normalize.ts has to accept.

// srs.py practice_queue() / _card_payload(); same card shape as GET /api/srs/queue
export const srsQueue = {
  cards: [
    {
      id: "card_0b27f825043c4e9a8ccfbbe003636a09",
      note_id: "note_340c352f923a473e8d57bbb97f363978",
      mode: "listen",
      target: "",
      target_meta: {},
      due: "2026-10-17T13:29:03.075623+00:00",
      importance: 3,
      state: "new",
      created_at: "2026-10-17T13:29:03.075623+00:00",
      note: {
        id: "note_340c352f923a473e8d57bbb97f363978",
        sentence: "Nous habitons à Vancouver depuis deux ans.",
        translation_zh: "我们在温哥华住了两年。",
        translation_en: "We have lived in Vancouver for two years.",
        extra: {},
      },
      intervals: {
        "1": 60,
        "2": 330,
        "3": 600,
        "4": 691200,
      },
    },
    {
      id: "card_9b6e597ad8a74d4fa5350e96293e9cbc",
      note_id: "note_340c352f923a473e8d57bbb97f363978",
      mode: "speak",
      target: "",
      target_meta: {},
      due: "2026-10-17T13:29:03.075623+00:00",
      importance: 3,
      state: "new",
      created_at: "2026-10-17T13:29:03.075623+00:00",
      note: {
        id: "note_340c352f923a473e8d57bbb97f363978",
        sentence: "Nous habitons à Vancouver depuis deux ans.",
        translation_zh: "我们在温哥华住了两年。",
        translation_en: "We have lived in Vancouver for two years.",
        extra: {},
      },
      intervals: {
        "1": 60,
        "2": 330,
        "3": 600,
        "4": 691200,
      },
    },
    {
      id: "card_e51980e2b7c548cb89ff19a6202f635c",
      note_id: "note_340c352f923a473e8d57bbb97f363978",
      mode: "cloze",
      target: "habitons",
      target_meta: {
        meaning_zh: "居住",
        meaning_en: "live",
      },
      due: "2026-10-17T13:29:03.075623+00:00",
      importance: 3,
      state: "new",
      created_at: "2026-10-17T13:29:03.075623+00:00",
      note: {
        id: "note_340c352f923a473e8d57bbb97f363978",
        sentence: "Nous habitons à Vancouver depuis deux ans.",
        translation_zh: "我们在温哥华住了两年。",
        translation_en: "We have lived in Vancouver for two years.",
        extra: {},
      },
      intervals: {
        "1": 60,
        "2": 330,
        "3": 600,
        "4": 691200,
      },
    },
    {
      id: "card_7af88794149445088bcb35b715f40a8d",
      note_id: "note_340c352f923a473e8d57bbb97f363978",
      mode: "recognize",
      target: "depuis",
      target_meta: {
        meaning_zh: "自从",
        meaning_en: "since",
        ipa: "dəpɥi",
      },
      due: "2026-10-17T13:29:03.075623+00:00",
      importance: 3,
      state: "new",
      created_at: "2026-10-17T13:29:03.075623+00:00",
      note: {
        id: "note_340c352f923a473e8d57bbb97f363978",
        sentence: "Nous habitons à Vancouver depuis deux ans.",
        translation_zh: "我们在温哥华住了两年。",
        translation_en: "We have lived in Vancouver for two years.",
        extra: {},
      },
      intervals: {
        "1": 60,
        "2": 330,
        "3": 600,
        "4": 691200,
      },
    },
    {
      id: "card_eb86a58d90de40848e2b696bbf2c4c18",
      note_id: "note_340c352f923a473e8d57bbb97f363978",
      mode: "grammar",
      target: "depuis + durée",
      target_meta: {
        rule: "depuis + durée",
        prompt_fr: "Nous habitons ici ____ deux ans.",
        answer: "depuis",
        hint: "since",
        full_fr: "Nous habitons ici depuis deux ans.",
        full_en: "We have lived here for two years.",
      },
      due: "2026-10-17T13:29:03.075623+00:00",
      importance: 3,
      state: "new",
      created_at: "2026-10-17T13:29:03.075623+00:00",
      note: {
        id: "note_340c352f923a473e8d57bbb97f363978",
        sentence: "Nous habitons à Vancouver depuis deux ans.",
        translation_zh: "我们在温哥华住了两年。",
        translation_en: "We have lived in Vancouver for two years.",
        extra: {},
      },
      intervals: {
        "1": 60,
        "2": 330,
        "3": 600,
        "4": 691200,
      },
    },
  ],
  counts: {
    learning: 0,
    review: 0,
    new: 5,
    total: 5,
  },
};

// tts_service.py GET /api/write/tasks (writing.TASKS + curriculum.training_tasks)
export const writeTasks = {
  recommended_task: "T1",
  recommended_level: "A1",
  tasks: {
    T1: {
      id: "T1",
      name: "Tâche 1 : Message / courriel",
      name_en: "Task 1: Message / email",
      desc: "Écrire un message ou courriel amical ou professionnel (60–120 mots).",
      desc_en: "Write a friendly or professional message/email (60–120 words).",
      min_words: 60,
      max_words: 120,
      timer_seconds: 600,
      recommended_levels: ["A1", "A2"],
    },
    T2: {
      id: "T2",
      name: "Tâche 2 : Récit d'une expérience / article",
      name_en: "Task 2: Experience story / article",
      desc: "Raconter une expérience personnelle ou un événement marquant (120–150 mots).",
      desc_en: "Share a personal experience, event or article (120–150 words).",
      min_words: 120,
      max_words: 150,
      timer_seconds: 1200,
      recommended_levels: ["B1"],
    },
    T3: {
      id: "T3",
      name: "Tâche 3 : Comparaison et prise de position",
      name_en: "Task 3: Comparison and opinion",
      desc: "Comparer deux textes d'opinion (40–60 mots), puis exprimer et justifier votre position (80–120 mots).",
      desc_en:
        "Compare two opinion texts (40–60 words), then state and justify your own position (80–120 words).",
      min_words: 120,
      max_words: 180,
      part1_range: "40–60",
      part2_range: "80–120",
      timer_seconds: 1800,
      recommended_levels: ["B2"],
    },
    P0: {
      id: "P0",
      name: "A1 起步 · 三句话",
      name_en: "A1 starter · three sentences",
      min_words: 6,
      max_words: 35,
      timer_seconds: 0,
      level: "A1",
      practice: true,
      error_limit: 2,
    },
    P1: {
      id: "P1",
      name: "A1 巩固 · 短消息",
      name_en: "A1 practice · short message",
      min_words: 20,
      max_words: 40,
      timer_seconds: 0,
      level: "A1",
      practice: true,
      error_limit: 2,
    },
    P2: {
      id: "P2",
      name: "A2 · 生活短文",
      name_en: "A2 · everyday writing",
      min_words: 40,
      max_words: 80,
      timer_seconds: 0,
      level: "A2",
      practice: true,
      error_limit: 3,
    },
  },
  subjects: {
    T1: [
      {
        id: "t1_1",
        title: "Invitation à un dîner de crémaillère",
        prompt:
          "Vous venez d'emménager dans un nouvel appartement à Montréal. Vous écrivez un courriel à vos collègues pour les inviter à un dîner vendredi prochain chez vous.",
        requirements: [
          "Expliquer la raison de l'invitation",
          "Indiquer la date, l'heure et l'adresse",
          "Demander de confirmer la présence avant mercredi",
        ],
      },
    ],
    T2: [
      {
        id: "t2_1",
        title: "Mon premier mois au Canada",
        prompt:
          "Racontez pour le blog des nouveaux arrivants votre premier mois dans une ville canadienne : vos surprises, vos découvertes et vos premiers défis.",
        requirements: [
          "Décrire votre arrivée et vos premières impressions",
          "Raconter une difficulté rencontrée et comment vous l'avez surmontée",
          "Donner un conseil utile à ceux qui arrivent bientôt",
        ],
      },
    ],
    T3: [
      {
        id: "t3_1",
        title: "Le travail à distance généralisé",
        prompt:
          "Vous devez rédiger un texte en deux parties : comparez les deux documents ci-dessous (40–60 mots), puis exprimez votre opinion personnelle argumentée (80–120 mots).",
        doc1: "Le télétravail représente une véritable avancée sociale et écologique. En supprimant les temps de transport quotidiens, il réduit le stress et l'empreinte carbone des salariés tout en favorisant un meilleur équilibre entre vie professionnelle et vie de famille. La productivité s'en trouve accrue et l'autonomie des équipes renforcée.",
        doc2: "La généralisation du travail à domicile détruit la cohésion d'équipe et fragilise le lien social. De nombreux employés souffrent d'isolement et peinent à déconnecter le soir, ce qui augmente le risque de burn-out. De plus, l'absence de contact informel au bureau nuit à la créativité et à l'intégration des nouvelles recrues.",
      },
    ],
    P0: [
      {
        id: "P0_cafe",
        theme: "cafe",
        title: "买一杯咖啡",
        title_en: "At the café",
        prompt: "用自己的信息写三句话。先填句型，再试着独立写。",
        prompt_en:
          "Write three sentences using your own details. Use the starters, then try independently.",
        requirements: ["表达清楚一件事", "加入时间、地点或数量等细节"],
        requirements_en: ["Express one clear intention", "Include a time, place or quantity"],
        stems: ["Je voudrais ___.", "Sans ___, s’il vous plaît.", "Ça coûte ___ euros."],
        words: ["un café · 咖啡 / coffee", "sans · 不加 / without", "trois · 三 / three"],
      },
    ],
    P1: [
      {
        id: "P1_cafe",
        theme: "cafe",
        title: "买一杯咖啡",
        title_en: "At the café",
        prompt: "围绕这个生活场景，给朋友写一条简短消息。使用自己的信息。",
        prompt_en:
          "Write a short message to a friend about this everyday situation. Use your own details.",
        requirements: ["表达清楚一件事", "加入时间、地点或数量等细节"],
        requirements_en: ["Express one clear intention", "Include a time, place or quantity"],
        stems: ["Je voudrais ___.", "Sans ___, s’il vous plaît.", "Ça coûte ___ euros."],
        words: ["un café · 咖啡 / coffee", "sans · 不加 / without", "trois · 三 / three"],
      },
    ],
    P2: [
      {
        id: "P2_cafe",
        theme: "cafe",
        title: "买一杯咖啡",
        title_en: "At the café",
        prompt: "围绕这个生活场景，给朋友写一条简短消息。使用自己的信息。",
        prompt_en:
          "Write a short message to a friend about this everyday situation. Use your own details.",
        requirements: ["表达清楚一件事", "加入时间、地点或数量等细节"],
        requirements_en: ["Express one clear intention", "Include a time, place or quantity"],
        stems: [],
        words: ["un café · 咖啡 / coffee", "sans · 不加 / without", "trois · 三 / three"],
      },
    ],
  },
};

// tts_service.py GET /api/speak/tasks (speaking.TASKS / SUBJECTS)
export const speakTasks = {
  recommended_task: "T1",
  recommended_level: "A1",
  tasks: {
    T1: {
      id: "T1",
      name: "Tâche 1 : Entretien dirigé",
      name_en: "Task 1: Guided interview",
      desc: "L'examinateur pose 4 à 6 questions personnelles sur votre vie quotidienne, votre travail ou vos projets (environ 2 min).",
      desc_en:
        "The examiner asks 4–6 personal questions about your daily life, work, or plans (~2 min).",
      timer_seconds: 120,
      recommended_levels: ["A1", "A2"],
    },
    T2: {
      id: "T2",
      name: "Tâche 2 : Exercice en interaction",
      name_en: "Task 2: Role-play interaction",
      desc: "Vous devez poser des questions pour obtenir des informations sur une situation de la vie quotidienne (3 min 30).",
      desc_en: "You ask the questions to obtain information in a daily-life situation (3m 30s).",
      timer_seconds: 210,
      prep_seconds: 120,
      recommended_levels: ["B1"],
    },
    T3: {
      id: "T3",
      name: "Tâche 3 : Expression d'un point de vue",
      name_en: "Task 3: Opinion monologue",
      desc: "Présenter votre opinion argumentée sur un sujet de société : prise de position, arguments, exemple, conclusion (4 min 30).",
      desc_en:
        "Present your reasoned opinion on a topic: stance, arguments, example, conclusion (4m 30s).",
      timer_seconds: 270,
      timer_seconds_beginner: 120,
      recommended_levels: ["B2"],
    },
  },
  subjects: {
    T1: [
      {
        id: "t1_s1",
        title: "Présentation et ville d'origine",
        prompt: "Parlez-moi de vous et de l'endroit où vous habitez.",
        questions: [
          "Bonjour ! Pour commencer, comment vous vous appelez et où habitez-vous actuellement ?",
          "Pouvez-vous me décrire brièvement votre quartier ou votre ville ?",
          "Depuis combien de temps vivez-vous à cet endroit ?",
          "Qu'est-ce qui vous plaît le plus dans votre ville au quotidien ?",
        ],
      },
    ],
    T2: [
      {
        id: "t2_s1",
        title: "Inscription à un centre sportif",
        prompt:
          "Vous voulez vous inscrire à un centre sportif à Montréal. Vous posez des questions à l'employé(e) pour obtenir des renseignements.",
        role_examiner:
          "Vous êtes l'employé à l'accueil du centre sportif. Répondez poliment et brièvement aux questions du candidat.",
        target_points: [
          "Horaires d'ouverture",
          "Tarifs des abonnements",
          "Cours collectifs disponibles",
          "Équipement requis",
        ],
      },
    ],
    T3: [
      {
        id: "t3_s1",
        title: "Le travail à distance généralisé",
        prompt:
          "« Le travail à distance à temps plein est une opportunité formidable pour les salariés et les entreprises. » Partagez-vous ce point de vue ?",
        structure_hints: [
          "Votre position claire",
          "Argument 1 : bien-être / gain de temps",
          "Argument 2 : risque d'isolement ou limites",
          "Exemple concret",
          "Conclusion",
        ],
      },
    ],
  },
};

// writing.py create_attempt() right after POST /api/write/attempts
export const writeAttemptGenerating1 = {
  id: "ce8a5357f873442ab3b03c46b9f51ce4",
  user_id: 1,
  task: "T1",
  subject: {
    id: "t1_1",
    title: "Invitation à un dîner de crémaillère",
    prompt:
      "Vous venez d'emménager dans un nouvel appartement à Montréal. Vous écrivez un courriel à vos collègues pour les inviter à un dîner vendredi prochain chez vous.",
    requirements: [
      "Expliquer la raison de l'invitation",
      "Indiquer la date, l'heure et l'adresse",
      "Demander de confirmer la présence avant mercredi",
    ],
  },
  level: "A2",
  status: "generating_1",
  text_1: "Salut Marc, je t'invite samedi.",
  feedback_1: {},
  text_2: "",
  feedback_2: {},
  seconds: 120,
  error: "",
  created_at: "2026-10-17T13:29:03.125504+00:00",
  updated_at: "2026-10-17T13:29:03.125504+00:00",
};

// writing.py get_attempt() after set_attempt_feedback_1()
export const writeAttemptReady1 = {
  id: "ce8a5357f873442ab3b03c46b9f51ce4",
  user_id: 1,
  task: "T1",
  subject: {
    id: "t1_1",
    title: "Invitation à un dîner de crémaillère",
    prompt:
      "Vous venez d'emménager dans un nouvel appartement à Montréal. Vous écrivez un courriel à vos collègues pour les inviter à un dîner vendredi prochain chez vous.",
    requirements: [
      "Expliquer la raison de l'invitation",
      "Indiquer la date, l'heure et l'adresse",
      "Demander de confirmer la présence avant mercredi",
    ],
  },
  level: "A2",
  status: "ready",
  text_1: "Salut Marc, je t'invite samedi.",
  feedback_1: {
    word_count: {
      count: 6,
      min: 60,
      max: 120,
      ok: false,
    },
    checklist: [
      {
        point: "Greeting",
        covered: true,
        note: "",
      },
    ],
    register: {
      expected: "informal",
      ok: true,
      note: "",
    },
    t3_comparison: null,
    praise: "Nice invitation!",
    errors: [
      {
        span: "invite",
        type: "verb form",
        hint: "Check the verb form.",
      },
    ],
  },
  text_2: "",
  feedback_2: {},
  seconds: 120,
  error: "",
  created_at: "2026-10-17T13:29:03.125504+00:00",
  updated_at: "2026-10-17T13:29:03.129458+00:00",
};

// writing.py update_attempt_round2() right after POST .../round2
export const writeAttemptGenerating2 = {
  id: "ce8a5357f873442ab3b03c46b9f51ce4",
  user_id: 1,
  task: "T1",
  subject: {
    id: "t1_1",
    title: "Invitation à un dîner de crémaillère",
    prompt:
      "Vous venez d'emménager dans un nouvel appartement à Montréal. Vous écrivez un courriel à vos collègues pour les inviter à un dîner vendredi prochain chez vous.",
    requirements: [
      "Expliquer la raison de l'invitation",
      "Indiquer la date, l'heure et l'adresse",
      "Demander de confirmer la présence avant mercredi",
    ],
  },
  level: "A2",
  status: "generating_2",
  text_1: "Salut Marc, je t'invite samedi.",
  feedback_1: {
    word_count: {
      count: 6,
      min: 60,
      max: 120,
      ok: false,
    },
    checklist: [
      {
        point: "Greeting",
        covered: true,
        note: "",
      },
    ],
    register: {
      expected: "informal",
      ok: true,
      note: "",
    },
    t3_comparison: null,
    praise: "Nice invitation!",
    errors: [
      {
        span: "invite",
        type: "verb form",
        hint: "Check the verb form.",
      },
    ],
  },
  text_2: "Salut Marc, je t'invite à dîner samedi.",
  feedback_2: {},
  seconds: 210,
  error: "",
  created_at: "2026-10-17T13:29:03.125504+00:00",
  updated_at: "2026-10-17T13:29:03.132410+00:00",
};

// writing.py get_attempt() after set_attempt_feedback_2()
export const writeAttemptReady2 = {
  id: "ce8a5357f873442ab3b03c46b9f51ce4",
  user_id: 1,
  task: "T1",
  subject: {
    id: "t1_1",
    title: "Invitation à un dîner de crémaillère",
    prompt:
      "Vous venez d'emménager dans un nouvel appartement à Montréal. Vous écrivez un courriel à vos collègues pour les inviter à un dîner vendredi prochain chez vous.",
    requirements: [
      "Expliquer la raison de l'invitation",
      "Indiquer la date, l'heure et l'adresse",
      "Demander de confirmer la présence avant mercredi",
    ],
  },
  level: "A2",
  status: "ready",
  text_1: "Salut Marc, je t'invite samedi.",
  feedback_1: {
    word_count: {
      count: 6,
      min: 60,
      max: 120,
      ok: false,
    },
    checklist: [
      {
        point: "Greeting",
        covered: true,
        note: "",
      },
    ],
    register: {
      expected: "informal",
      ok: true,
      note: "",
    },
    t3_comparison: null,
    praise: "Nice invitation!",
    errors: [
      {
        span: "invite",
        type: "verb form",
        hint: "Check the verb form.",
      },
    ],
  },
  text_2: "Salut Marc, je t'invite à dîner samedi.",
  feedback_2: {
    fixed_errors: [],
    remaining_errors: [],
    corrected_text: "Salut Marc, je t'invite à dîner samedi.",
    sentences: [
      {
        original: "je t'invite samedi",
        corrected: "je t'invite à dîner samedi",
        explanation: "inviter à",
        chunk: "inviter à",
      },
    ],
    structures: [
      {
        french: "inviter quelqu'un à",
        english: "invite someone to",
        usage: "invitation",
      },
    ],
  },
  seconds: 210,
  error: "",
  created_at: "2026-10-17T13:29:03.125504+00:00",
  updated_at: "2026-10-17T13:29:03.135664+00:00",
};

// speaking.py get_attempt() after set_attempt_feedback_1() (task T2)
export const speakAttemptReady = {
  id: "9739ace49e7245f388372c012d4d77ba",
  user_id: 1,
  task: "T2",
  subject: {
    id: "t2_s1",
    title: "Inscription à un centre sportif",
    prompt:
      "Vous voulez vous inscrire à un centre sportif à Montréal. Vous posez des questions à l'employé(e) pour obtenir des renseignements.",
    role_examiner:
      "Vous êtes l'employé à l'accueil du centre sportif. Répondez poliment et brièvement aux questions du candidat.",
    target_points: [
      "Horaires d'ouverture",
      "Tarifs des abonnements",
      "Cours collectifs disponibles",
      "Équipement requis",
    ],
  },
  level: "A2",
  status: "ready",
  transcript_1: "Bonjour, je voudrais un rendez-vous.",
  feedback_1: {
    stats: {
      duration_sec: 30.0,
      wpm: 14.0,
      pace_note: "slow",
    },
    checklist: [],
    t2_questions: {
      count: 3,
      forms_ok: true,
      note: "",
    },
    t3_structure: null,
    praise: "Polite opening.",
    errors: [
      {
        span: "voudrais",
        type: "verb form",
        hint: "Check the tense.",
      },
    ],
  },
  transcript_2: "",
  feedback_2: {},
  seconds: 60,
  audio_duration: 30.0,
  wpm: 10.0,
  error: "",
  created_at: "2026-10-17T13:29:03.138145+00:00",
  updated_at: "2026-10-17T13:29:03.141511+00:00",
};

// tts_service.py GET /api/episodes (episodes.py _row_payload wrapped in a dict)
export const episodesList = {
  episodes: [
    {
      id: "c1062ac5bad946daaa54dabf7f305715",
      title: "",
      status: "generating",
      duration: 0.0,
      error: "",
      created_at: "2026-10-17T13:29:03.146658+00:00",
      settings: {
        level: "A2",
        minutes: 20,
        request: "",
      },
    },
  ],
  hours: 0.0,
  recommended_level: "A1",
  levels: ["A1", "A2", "B1", "B2"],
  lengths: [20, 30, 45, 60],
};

// tts_service.py POST /api/episodes returns the bare episode
export const episodeCreated = {
  id: "c1062ac5bad946daaa54dabf7f305715",
  title: "",
  status: "generating",
  duration: 0.0,
  error: "",
  created_at: "2026-10-17T13:29:03.146658+00:00",
  settings: {
    level: "A2",
    minutes: 20,
    request: "",
  },
};
