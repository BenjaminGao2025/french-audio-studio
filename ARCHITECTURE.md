# 架构与维护

## 结构

- `tts_service.py` 创建 FastAPI 应用、注册路由和静态目录、设置安全响应头、提供健康检查，并在启动时将中断的反馈任务标记为失败。
- `routers/` 按认证、历史、SRS、工作台、精析、写作、口语、教练和个人练习等职责组织 HTTP 路由。路由注册顺序影响重叠路径；移动或新增路由时应核对匹配顺序与 OpenAPI。
- `services/ai.py` 管理上游 AI 调用和鉴权，`services/speech.py` 处理语音合成，`services/asr.py` 处理识别和并发队列；`transform.py`、`analysis.py`、`intake.py` 等包含文本处理流程。
- `auth_db.py` 与 `srs.py`、`writing.py`、`speaking.py`、`episodes.py`、`coach.py` 等存储学习数据，SQLite 数据库和生成的音频在 `OUTPUT_DIR`。模块的建表与迁移按数据库文件和模块在进程内惰性执行；新增迁移须保持幂等。
- `dictation.py` 与 `routers/dictation.py` 提供 /study 的默写/听写：评分在本地完成（`static/dictation.js` 镜像同一规则，`tests/fixtures/dictation_cases.json` 保证两边一致）；客户端只登记题目（句子、英文、逐步拆分），作答时服务端从该用户自己的题目推导标准答案，不接受客户端传来的答案或用户 ID。AI 批改只在用户点击时调用并按用户缓存。
- `phrase_context.py` 与 `static/phrase-context.js` 为 /study 的词卡找出句中的固定搭配（à partir de 等），两边匹配规则相同（`tests/fixtures/phrase_cases.json`）。来源依次为：精析返回的 `phrases`、词表里的多词条目和 “Part of the phrase …” 注释；旧句子两者都没有时才调用 `POST /api/phrase-context`，每个用户每句只调用一次模型，结果（含空列表）按用户、句子和 `VERSION` 缓存在 `phrase_context_cache` 表。
- /study 词卡分两块：「词典」是词本身（内置词典 → 页内缓存 → `GET /api/lookup`，不随句子变化）；「语境」是这一次出现的词：句中位置由 `word_context.py` 与 `static/word-context.js` 用同一规则计算（`tests/fixtures/word_context_cases.json`），词表的“这里的意思”直接复用，中文“为什么”在打开词卡时才调用 `POST /api/word-context`，按用户、句子、词、第几次出现和 `VERSION` 缓存在 `word_context_cache` 表（含空结果）；固定搭配显示在「语境」里，此时不再调用模型。嵌套查词、数字、多词选段没有语境。
- `static/` 提供无需编译的浏览器界面。资源版本用于更新缓存；service worker 不缓存 API、认证和音频。
- 旧 React SPA 的源码在 `frontend/`、构建产物在 `static/app/`，由 `routers/app_shell.py` 提供；默认关闭（`/app` 跳转 `/study`），`APP_SHELL_ENABLED=1` 时启用。它使用的 `routers/cockpit.py`（今日计划、学时账本、待办、每日复盘、阶段）与 `routers/comprehension.py`（听力/阅读材料）始终注册。
- `Dockerfile` 按显式清单复制顶层 Python 模块，新增顶层模块时须同步加入；未跟踪的本地文件不会进入镜像。

## 运行约束

登录、注册的密码计算放在线程池；认证限流是进程内令牌桶，不替代跨实例防护。仅从本机代理信任客户端 IP 转发头，改变部署拓扑时须重新审查。AI 凭据保存在服务端；客户端会话不是上游密钥。

写作、口语和剧集的长任务在后台执行；进程重启时，未完成的反馈会标记为失败，客户端应允许重试。后台任务不等同于持久化作业队列。

`requirements.in` 声明直接依赖，`requirements.txt` 固定完整依赖。更新依赖后用文件顶部注明的 `uv pip compile` 命令重新生成，并在 Python 3.11 上运行测试。测试中 mock 应 patch **实际使用该名称的模块**，例如 `routers.tutor` 或 `services.ai`，而非旧的 `tts_service` 聚合模块。`tests/testenv.py` 必须在导入应用之前设置隔离环境。

生产部署与回滚流程见 `.github/workflows/deploy.yml`。数据库回滚需要单独恢复备份；镜像回滚不会撤销数据库变更。当前容器以 root 运行，备份与源数据位于同一磁盘，均需根据生产环境继续加固。
