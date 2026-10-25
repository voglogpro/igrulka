FROM node:24-bookworm-slim AS build
WORKDIR /usr/src/skyfront
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 MAX_ROOMS=2
WORKDIR /usr/src/skyfront
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build --chown=node:node /usr/src/skyfront/server ./server
COPY --from=build --chown=node:node /usr/src/skyfront/scripts ./scripts
COPY --from=build --chown=node:node /usr/src/skyfront/src ./src
COPY --from=build --chown=node:node /usr/src/skyfront/assets ./assets
COPY --from=build --chown=node:node /usr/src/skyfront/vendor ./vendor
COPY --from=build --chown=node:node /usr/src/skyfront/play ./play
COPY --from=build --chown=node:node /usr/src/skyfront/index.html ./index.html
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "require('http').get({host:'127.0.0.1',port:process.env.PORT||8080,path:'/healthz'},r=>{r.resume();process.exitCode=r.statusCode===200?0:1}).on('error',()=>{process.exitCode=1})"
CMD ["node", "server/hosted.mjs"]
