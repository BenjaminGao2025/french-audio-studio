# 架构与维护

## 结构

- `tts_service.py` 创建 FastAPI 应用、注册路由和静态目录、设置安全响应头、提供健康检查，并在启动时将中断的反馈任务标记为失败。
- `routers/` 按认证、历史、SRS、工作台、精析、写作、口语、教练和个人练习等职责组织 HTTP 路由。路由注册顺序影响重叠路径；移动或新增路由时应核对匹配顺序与 OpenAPI。
- `services/ai.py` 管理上游 AI 调用和鉴权，`services/speech.py` 处理语音合成，`services/asr.py` 处理识别和并发队列；`transform.py`、`analysis.py`、`intake.py` 等包含文本处理流程。
- `auth_db.py` 与 `srs.py`、`writing.py`、`speaking.py`、`episodes.py`、`coach.py` 等存储学习数据，SQLite 数据库和生成的音频在 `OUTPUT_DIR`。模块的建表与迁移按数据库文件和模块在进程内惰性执行；新增迁移须保持幂等。
- `static/` 提供无需编译的浏览器界面。资源版本用于更新缓存；service worker 不缓存 API、认证和音频。

## 运行约束

登录、注册的密码计算放在线程池；认证限流是进程内令牌桶，不替代跨实例防护。仅从本机代理信任客户端 IP 转发头，改变部署拓扑时须重新审查。AI 凭据保存在服务端；客户端会话不是上游密钥。

写作、口语和剧集的长任务在后台执行；进程重启时，未完成的反馈会标记为失败，客户端应允许重试。后台任务不等同于持久化作业队列。

`requirements.in` 声明直接依赖，`requirements.txt` 固定完整依赖。更新依赖后用文件顶部注明的 `uv pip compile` 命令重新生成，并在 Python 3.11 上运行测试。测试中 mock 应 patch **实际使用该名称的模块**，例如 `routers.tutor` 或 `services.ai`，而非旧的 `tts_service` 聚合模块。`tests/testenv.py` 必须在导入应用之前设置隔离环境。

生产部署与回滚流程见 `.github/workflows/deploy.yml`。数据库回滚需要单独恢复备份；镜像回滚不会撤销数据库变更。当前容器以 root 运行，备份与源数据位于同一磁盘，均需根据生产环境继续加固。
