FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Every top-level module is app code (tests, scripts and tools live in subfolders).
COPY *.py ./
COPY routers /app/routers
COPY services /app/services
COPY scripts /app/scripts
COPY data /app/data
COPY static /app/static

RUN mkdir -p /app/outputs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=3)" || exit 1

CMD ["python", "tts_service.py"]
