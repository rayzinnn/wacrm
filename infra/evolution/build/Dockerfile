FROM evoapicloud/evolution-api:v2.3.7@sha256:0e5d84f45b390e1d659500c9a98bfa2a53be28a341fbc0864966b77485f2a0c5

LABEL org.opencontainers.image.title="WACRM Evolution API without raw upsert stdout"
LABEL org.opencontainers.image.version="2.3.7-local-nobrutelog"
LABEL org.opencontainers.image.revision="cd800f2976e1e5b682fbf86a01ee4d85ae61f370"

COPY patch-messages-upsert-log.mjs /tmp/patch-messages-upsert-log.mjs
RUN node /tmp/patch-messages-upsert-log.mjs \
    /evolution/dist/api/integrations/channel/whatsapp/whatsapp.baileys.service.js \
    /evolution/dist/api/integrations/channel/whatsapp/whatsapp.baileys.service.mjs \
    && rm /tmp/patch-messages-upsert-log.mjs
