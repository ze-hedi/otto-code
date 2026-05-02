FROM ubuntu:22.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
