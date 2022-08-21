FROM ubuntu:22.04
RUN apt update && apt install -y libpano13-bin imagemagick zip nodejs
WORKDIR /app/
COPY ./ /app/
ENTRYPOINT node server.js
