FROM node:20-alpine
WORKDIR /demo-agent
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "worker-sim.js"]
