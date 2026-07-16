# Stage 1: Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies including devDependencies for the build
COPY package*.json ./
RUN npm install

# Copy application source code
COPY . .

# Build client assets and bundle/compile server.ts
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy compiled backend and built client assets from builder
COPY --from=builder /app/dist ./dist

# Copy initial subscription seed database
COPY --from=builder /app/src/data ./src/data

# Expose port 3000
EXPOSE 3000

# Start the application using CJS bundled server
CMD ["npm", "run", "start"]
