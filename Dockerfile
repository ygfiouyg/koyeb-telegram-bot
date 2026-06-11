FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY bot.js .
RUN mkdir -p /app/data
EXPOSE 8000
CMD ["node", "bot.js"]
