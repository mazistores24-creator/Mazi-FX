FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
COPY db ./db
RUN npm ci
EXPOSE 3000
CMD ["npx", "tsx", "apps/server/src/server.ts"]
