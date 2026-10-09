# Production image: builds the client and server, keeps only runtime dependencies.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/lab.sqlite
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/server/server/index.js"]
