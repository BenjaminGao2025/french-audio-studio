# Build the SPA (web/) on its own stage; only its dist/ reaches the final image.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Explicit list of tracked app modules: a stray untracked *.py in the checkout (scratch files,
# helpers from other projects) must never ship. Add a new top-level module here when you create one.
COPY analysis.py auth_db.py coach.py cockpit.py comprehension.py curriculum.py dictation.py edge_compat.py \
     episodes.py game.py grammar.py intake.py journal.py phrase_context.py speaking.py srs.py transform.py \
     tts_service.py web_common.py word_context.py writing.py ./
COPY routers /app/routers
COPY services /app/services
COPY scripts /app/scripts
COPY data /app/data
COPY static /app/static
COPY --from=web /web/dist /app/static/app

RUN mkdir -p /app/outputs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)" || exit 1

CMD ["python", "tts_service.py"]
