# Build stage: compile TypeScript.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Run stage: only production dependencies and the compiled code.
FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# Server files: sitelog-deploy copies them out of the image on every deploy.
COPY deploy ./deploy
# Amazon RDS certificate bundle, so the database connection is verified (DATABASE_SSL_CA_PATH).
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 644 /app/certs/rds-global-bundle.pem
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
