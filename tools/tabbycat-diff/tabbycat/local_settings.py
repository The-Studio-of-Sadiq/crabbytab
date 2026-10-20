# Copied into the Tabbycat checkout as tabbycat/settings/local.py (Tabbycat's split settings
# include it when no hosting environment is detected). Only what the differential harness needs:
# a database from DATABASE_URL, no Redis, no Sentry. The secret key is a fixed placeholder because
# the harness never serves requests; nothing here is a credential.
import os

import dj_database_url

DATABASES = {'default': dj_database_url.parse(os.environ['DATABASE_URL'])}
SECRET_KEY = 'tabbycat-diff-harness-not-a-secret'
DEBUG = False
ALLOWED_HOSTS = ['localhost']
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
DISABLE_SENTRY = True
