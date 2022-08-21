FROM ubuntu:22.04
RUN apt update && apt install -y libpano13-bin imagemagick zip
RUN curl -sL https://deb.nodesource.com/setup_20.x | bash -
WORKDIR /app/
COPY ./ /app/
RUN npm install
ENTRYPOINT node server.js
