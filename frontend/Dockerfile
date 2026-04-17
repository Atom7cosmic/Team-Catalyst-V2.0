FROM node:20

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy app files
COPY . .

# Build
RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "dev"]
