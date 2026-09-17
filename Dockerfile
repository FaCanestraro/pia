# Gerador Piá · imagem para Fly.io / Cloud Run / qualquer runtime de container
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependências primeiro, para aproveitar o cache de camada
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código e assets (character sheet, prompt, frontend)
COPY . .

EXPOSE 8080
CMD ["npm", "start"]
