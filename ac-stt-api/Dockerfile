FROM node:20.12.1-alpine3.19 AS base
WORKDIR /app
COPY package*.json .

FROM base AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base
ENV NODE_ENV=production
RUN npm ci
COPY --from=build /app/dist /app/dist
CMD ["node", "dist/mock-ac-stt.js"]
