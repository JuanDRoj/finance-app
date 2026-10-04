# Emulador local de Firebase Auth (no existe imagen oficial de Google).
FROM node:22-slim

# Version fija de firebase-tools para que el entorno sea reproducible.
ARG FIREBASE_TOOLS_VERSION=15.32.1
RUN npm install -g "firebase-tools@${FIREBASE_TOOLS_VERSION}" \
    && npm cache clean --force

# Usuario no root (la imagen node ya trae `node`, uid 1000).
USER node
WORKDIR /home/node/app
COPY --chown=node:node firebase.json ./

# Descarga la UI del emulador al construir la imagen, no al arrancar.
RUN firebase setup:emulators:ui

ENV FIREBASE_PROJECT_ID=demo-finance-local
EXPOSE 4000 9099

# El prefijo `demo-` garantiza que el emulador no toca la nube ni pide login.
CMD ["sh", "-c", "exec firebase emulators:start --only auth --project \"$FIREBASE_PROJECT_ID\""]
