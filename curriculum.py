"""Small, reviewed A1 lessons. Practice targets, never exam score estimates."""
import copy

# Each lesson connects listening, writing and speaking around the same everyday intention.
LESSONS = [
    dict(id='cafe', title_zh='买一杯咖啡', title_en='At the café',
         lines=[('Bonjour. Je voudrais un café.', '你好。我想要一杯咖啡。', 'Hello. I would like a coffee.'), ('Sans sucre, s’il vous plaît.', '请不要加糖。', 'No sugar, please.'), ('Ça coûte trois euros.', '这要三欧元。', 'It costs three euros.')],
         questions=[('他想买什么？', 'What does he want?', ['咖啡 / Coffee', '茶 / Tea', '水 / Water'], 0), ('要加糖吗？', 'Does he want sugar?', ['是 / Yes', '不加 / No', '没说 / Not stated'], 1), ('多少钱？', 'How much is it?', ['2 €', '5 €', '3 €'], 2)],
         stems=['Je voudrais ___.', 'Sans ___, s’il vous plaît.', 'Ça coûte ___ euros.'], words=['un café · 咖啡 / coffee', 'sans · 不加 / without', 'trois · 三 / three']),
    dict(id='appointment', title_zh='约个时间', title_en='An appointment',
         lines=[('Je voudrais un rendez-vous.', '我想预约。', 'I would like an appointment.'), ('Je suis libre mardi.', '我星期二有空。', 'I am free on Tuesday.'), ('À dix heures, s’il vous plaît.', '请安排在十点。', 'At ten, please.')],
         questions=[('他想做什么？', 'What does he want to do?', ['买票 / Buy a ticket', '预约 / Make an appointment', '取消 / Cancel'], 1), ('哪天有空？', 'Which day is he free?', ['周一 / Monday', '周五 / Friday', '周二 / Tuesday'], 2), ('几点？', 'What time?', ['10:00', '12:00', '14:00'], 0)],
         stems=['Je voudrais ___.', 'Je suis libre ___.', 'À ___ heures, s’il vous plaît.'], words=['un rendez-vous · 预约 / appointment', 'libre · 有空 / free', 'mardi · 周二 / Tuesday']),
    dict(id='home', title_zh='介绍自己的家', title_en='My home',
         lines=[('J’habite à Montréal.', '我住在蒙特利尔。', 'I live in Montreal.'), ('Mon appartement est petit.', '我的公寓很小。', 'My apartment is small.'), ('J’habite avec ma famille.', '我和家人住在一起。', 'I live with my family.')],
         questions=[('住在哪座城市？', 'Which city?', ['Paris', 'Montréal', 'Ottawa'], 1), ('公寓怎么样？', 'What is the apartment like?', ['小 / Small', '大 / Big', '旧 / Old'], 0), ('和谁住？', 'Who lives with the speaker?', ['朋友 / Friends', '独居 / Alone', '家人 / Family'], 2)],
         stems=['J’habite à ___.', 'Mon appartement est ___.', 'J’habite avec ___.'], words=['habiter · 居住 / live', 'petit · 小 / small', 'ma famille · 我的家人 / my family']),
    dict(id='shopping', title_zh='买水果', title_en='Buying fruit',
         lines=[('Je voudrais deux pommes.', '我想买两个苹果。', 'I would like two apples.'), ('Elles coûtent quatre euros.', '它们要四欧元。', 'They cost four euros.'), ('Je paie par carte.', '我用卡付款。', 'I pay by card.')],
         questions=[('买什么？', 'What is being bought?', ['面包 / Bread', '苹果 / Apples', '牛奶 / Milk'], 1), ('多少钱？', 'How much?', ['2 €', '4 €', '6 €'], 1), ('怎么付款？', 'How does the speaker pay?', ['现金 / Cash', '没说 / Not stated', '刷卡 / Card'], 2)],
         stems=['Je voudrais ___ pommes.', 'Elles coûtent ___ euros.', 'Je paie par ___.'], words=['une pomme · 苹果 / apple', 'coûter · 花费 / cost', 'par carte · 刷卡 / by card']),
    dict(id='invitation', title_zh='邀请朋友', title_en='An invitation',
         lines=[('Salut ! Viens chez moi samedi.', '嗨！星期六来我家吧。', 'Hi! Come to my place on Saturday.'), ('Nous mangeons à midi.', '我们中午吃饭。', 'We eat at noon.'), ('Tu peux apporter du pain.', '你可以带些面包。', 'You can bring some bread.')],
         questions=[('邀请去哪？', 'Where is the invitation to?', ['家里 / Home', '学校 / School', '公园 / Park'], 0), ('什么时候吃饭？', 'When do they eat?', ['晚上 / Evening', '早上 / Morning', '中午 / Noon'], 2), ('可以带什么？', 'What can the friend bring?', ['花 / Flowers', '面包 / Bread', '咖啡 / Coffee'], 1)],
         stems=['Viens chez moi ___.', 'Nous mangeons à ___.', 'Tu peux apporter ___.'], words=['chez moi · 我家 / my place', 'à midi · 中午 / at noon', 'du pain · 面包 / bread']),
    dict(id='routine', title_zh='我的一天', title_en='My day',
         lines=[('Je travaille le matin.', '我早上工作。', 'I work in the morning.'), ('J’apprends le français le soir.', '我晚上学法语。', 'I learn French in the evening.'), ('Je me couche à dix heures.', '我十点睡觉。', 'I go to bed at ten.')],
         questions=[('什么时候工作？', 'When does the speaker work?', ['早上 / Morning', '晚上 / Evening', '周末 / Weekend'], 0), ('晚上学什么？', 'What is studied in the evening?', ['英语 / English', '法语 / French', '数学 / Maths'], 1), ('几点睡觉？', 'What time is bedtime?', ['9:00', '11:00', '10:00'], 2)],
         stems=['Je travaille ___.', 'J’apprends ___ le soir.', 'Je me couche à ___ heures.'], words=['le matin · 早上 / morning', 'le soir · 晚上 / evening', 'se coucher · 睡觉 / go to bed']),
]
# Held out of ordinary practice; these check transfer to different details.
CHALLENGES = [
    dict(id='check-library', title_zh='本周小挑战：图书馆', title_en='Weekly check: library',
         lines=[('Je vais à la bibliothèque.', '我去图书馆。', 'I go to the library.'), ('Elle ouvre à neuf heures.', '它九点开门。', 'It opens at nine.'), ('Je prends deux livres.', '我借两本书。', 'I take two books.')],
         questions=[('要去哪里？', 'Where is the speaker going?', ['咖啡店 / Café', '图书馆 / Library', '学校 / School'], 1), ('几点开门？', 'When does it open?', ['9:00', '10:00', '12:00'], 0), ('拿几本书？', 'How many books?', ['1', '3', '2'], 2)], stems=[], words=[]),
    dict(id='check-bus', title_zh='本周小挑战：乘公交', title_en='Weekly check: the bus',
         lines=[('Je prends le bus lundi.', '我星期一坐公交。', 'I take the bus on Monday.'), ('Je vais à l’école.', '我去学校。', 'I go to school.'), ('Le billet coûte deux euros.', '车票两欧元。', 'The ticket costs two euros.')],
         questions=[('哪天坐车？', 'Which day?', ['周一 / Monday', '周二 / Tuesday', '周六 / Saturday'], 0), ('去哪里？', 'Where to?', ['家 / Home', '商店 / Shop', '学校 / School'], 2), ('车票多少钱？', 'How much is the ticket?', ['3 €', '2 €', '5 €'], 1)], stems=[], words=[]),
]
BY_ID = {x['id']: x for x in LESSONS + CHALLENGES}


def public_lesson(lesson_id):
    lesson = copy.deepcopy(BY_ID[lesson_id])
    lesson['questions'] = [dict(zh=q[0], en=q[1], options=q[2]) for q in lesson['questions']]
    # Transcript is fetched separately, so it is not accidentally exposed before listening.
    lesson.pop('lines')
    return lesson


def training_tasks():
    return {
        'P0': dict(id='P0', name='A1 起步 · 三句话', name_en='A1 starter · three sentences', min_words=6, max_words=35, timer_seconds=0, level='A1', practice=True, error_limit=2),
        'P1': dict(id='P1', name='A1 巩固 · 短消息', name_en='A1 practice · short message', min_words=20, max_words=40, timer_seconds=0, level='A1', practice=True, error_limit=2),
        'P2': dict(id='P2', name='A2 · 生活短文', name_en='A2 · everyday writing', min_words=40, max_words=80, timer_seconds=0, level='A2', practice=True, error_limit=3),
    }


def training_subjects():
    result = {}
    for task in training_tasks():
        result[task] = [dict(id=f'{task}_{x["id"]}', theme=x['id'], title=x['title_zh'], title_en=x['title_en'],
            prompt='用自己的信息写三句话。先填句型，再试着独立写。' if task == 'P0' else '围绕这个生活场景，给朋友写一条简短消息。使用自己的信息。',
            prompt_en='Write three sentences using your own details. Use the starters, then try independently.' if task == 'P0' else 'Write a short message to a friend about this everyday situation. Use your own details.',
            requirements=['表达清楚一件事', '加入时间、地点或数量等细节'], requirements_en=['Express one clear intention', 'Include a time, place or quantity'],
            stems=x['stems'] if task != 'P2' else [], words=x['words']) for x in LESSONS]
    return result
