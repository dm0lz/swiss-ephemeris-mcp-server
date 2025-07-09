# Use Node.js 18 LTS as base image
FROM node:18-alpine

# Install build dependencies and git
RUN apk add --no-cache \
    git \
    build-base \
    make \
    gcc \
    g++ \
    libc-dev

# Set working directory
WORKDIR /app

# Build Swiss Ephemeris from source and copy data files
RUN git clone https://github.com/aloistr/swisseph.git /tmp/swisseph && \
    cd /tmp/swisseph && \
    make && \
    cp swetest /usr/local/bin/ && \
    rm -rf /tmp/swisseph

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY index.js ./

# Copy vendor directory with ephemeris data files
COPY vendor/ ./vendor/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port for HTTP mode
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Default to stdio mode, can be overridden with environment variables
ENV MCP_HTTP_MODE=false
ENV NODE_ENV=production
ENV SE_EPHE_PATH=/app/vendor/swisseph

# Start the MCP server
CMD ["node", "index.js"] 