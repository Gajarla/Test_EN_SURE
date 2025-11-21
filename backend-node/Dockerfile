FROM node
WORKDIR /home/node/app
RUN mkdir -p /home/node/app/node_modules && chown node /home/node/app/node_modules
COPY package*.json ./
RUN npm install --legacy-peer-deps && chown -R node:node ./node_modules
USER node
COPY --chown=node:node . .
COPY --chown=node:node .git .git
EXPOSE 5000
RUN echo $(git rev-parse HEAD) > metadata/githash && echo $(date) > metadata/version
CMD ["npm", "start:local"]
