FROM node:25-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system ecg && adduser --system --ingroup ecg ecg
COPY --from=builder /app/dist dist/
COPY --from=builder /app/node_modules node_modules/
COPY package.json ./
USER ecg
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "require('http').get('http://localhost:3100/healthz',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "dist/index.js"]
