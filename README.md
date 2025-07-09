# Swiss Ephemeris MCP Server

A Model Context Protocol (MCP) server that exposes Swiss Ephemeris astronomical calculations for birth chart generation.

## Features

- **Planetary Positions**: Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto
- **Additional Points**: North Node, South Node, Chiron, Lilith (Mean Apogee), Part of Fortune
- **House System**: Complete 12-house calculation using Placidus system
- **Chart Points**: Ascendant, Midheaven, IC, Descendant, Vertex, ARMC
- **Dual Transport**: Supports both stdio (Claude Desktop) and HTTP (Claude Web) modes

## Docker Deployment

### Quick Start with Docker Compose

#### For HTTP Mode (Claude Web + ngrok)
```bash
# Start HTTP server
docker-compose --profile http up -d

# The server will be available at http://localhost:8000
# Use ngrok to create HTTPS tunnel:
ngrok http 8000

# Connect Claude to: https://xyz.ngrok.io/mcp
```

#### For Stdio Mode (Claude Desktop)
```bash
# Build the image
docker-compose --profile stdio build

# For stdio mode, you'll need to integrate with your Claude Desktop config
# See configuration section below
```

### Manual Docker Commands

#### Build the Image
```bash
docker build -t swiss-ephemeris-mcp .
```

#### Run HTTP Mode
```bash
docker run -d \
  --name swiss-ephemeris-http \
  -p 8000:8000 \
  -e MCP_HTTP_MODE=true \
  swiss-ephemeris-mcp
```

#### Run Stdio Mode
```bash
docker run -it \
  --name swiss-ephemeris-stdio \
  -e MCP_HTTP_MODE=false \
  swiss-ephemeris-mcp
```

### Health Check
```bash
# Check if HTTP server is running
curl http://localhost:8000/health

# Check container logs
docker logs swiss-ephemeris-mcp-http
```

## Local Development

### Prerequisites
- Node.js 18+
- Swiss Ephemeris `swetest` command available in PATH

### Installation
```bash
# Install dependencies
npm install

# Start in stdio mode (default)
npm start

# Start in HTTP mode
MCP_HTTP_MODE=true npm start
```

## Configuration

### Claude Desktop (Stdio Mode)
Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "swissEphemeris": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "swiss-ephemeris-mcp"
      ]
    }
  }
}
```

### Claude Web (HTTP Mode)
1. Start the HTTP server: `docker-compose --profile http up -d`
2. Create ngrok tunnel: `ngrok http 8000`
3. Connect Claude to: `https://xyz.ngrok.io/mcp`

## API Usage

### Tool: `calculate_birth_chart`

**Parameters:**
- `datetime` (string): ISO8601 datetime (e.g., "1986-08-16T01:15:00Z")
- `latitude` (number): Latitude in decimal degrees (-90 to 90)
- `longitude` (number): Longitude in decimal degrees (-180 to 180)

**Example Request:**
```json
{
  "datetime": "1986-08-16T01:15:00Z",
  "latitude": 46.1436,
  "longitude": 6.0826
}
```

**Example Response:**
```json
{
  "planets": {
    "Sun": { "longitude": 142.9, "sign": "Leo", "degree": 22.9 },
    "Moon": { "longitude": 272.35, "sign": "Capricorn", "degree": 2.35 }
  },
  "houses": {
    "1": { "longitude": 103.66, "sign": "Cancer", "degree": 13.66 }
  },
  "chart_points": {
    "Ascendant": { "longitude": 103.66, "sign": "Cancer", "degree": 13.66 },
    "Midheaven": { "longitude": 348.01, "sign": "Pisces", "degree": 18.01 }
  },
  "additional_points": {
    "South Node": { "longitude": 202.82, "sign": "Libra", "degree": 22.82 },
    "Part of Fortune": { "longitude": 134.01, "sign": "Leo", "degree": 14.01 }
  },
  "datetime": "1986-08-16T01:15:00Z",
  "coordinates": { "latitude": 46.1436, "longitude": 6.0826 }
}
```

## Docker Image Details

- **Base Image**: `node:18-alpine`
- **Swiss Ephemeris**: Built from source (https://github.com/aloistr/swisseph.git)
- **Security**: Runs as non-root user
- **Size**: Optimized with multi-stage build and minimal dependencies
- **Health Check**: Built-in health monitoring

## License

MIT 

docker build --platform=linux/amd64 -t olivier86/swiss-ephemeris-mcp-server:latest --push . 