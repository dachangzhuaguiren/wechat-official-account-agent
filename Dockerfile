FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SAAS_DATABASE_PATH=/data/saas.sqlite

WORKDIR /app
COPY --chown=node:node . /app
RUN chmod 0755 /app/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown node:node /data

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "backend/server.mjs"]
