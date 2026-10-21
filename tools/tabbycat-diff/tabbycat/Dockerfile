# Official Tabbycat, pinned, with only what the differential harness needs (no Node build, no
# Redis, no web server). Build context: tools/tabbycat-diff/tabbycat.
FROM python:3.11.9-slim-bookworm

ARG TABBYCAT_TAG=v2.12.1
# The commit the tag pointed at when the golden files were generated; the build fails if it moved.
ARG TABBYCAT_COMMIT=ce9488b5ea0adbb6c61440cf38a2ffbdbee2b89d

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DISABLE_SENTRY=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Downloaded code lives in its own directory; harness scripts live in /harness.
RUN git clone --depth 1 --branch "${TABBYCAT_TAG}" https://github.com/TabbycatDebate/tabbycat.git /opt/tabbycat \
 && test "$(git -C /opt/tabbycat rev-parse HEAD)" = "${TABBYCAT_COMMIT}"

COPY lock_to_requirements.py local_settings.py run_tabbycat.py /harness/
RUN python -I /harness/lock_to_requirements.py /opt/tabbycat/Pipfile.lock /harness/requirements.txt \
 && pip install -r /harness/requirements.txt \
 && cp /harness/local_settings.py /opt/tabbycat/tabbycat/settings/local.py

WORKDIR /harness
