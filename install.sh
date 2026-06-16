#!/bin/bash

# Andaflare Installation Script
# https://github.com/sudo-tool/andaflare

set -e

echo "🛡️  Andaflare Installation"
echo "=========================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root (use sudo)"
    exit 1
fi

# Check system
echo "📋 Checking system requirements..."

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    echo "Please install Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check Docker Compose
COMPOSE_CMD="docker compose"
if ! $COMPOSE_CMD version &> /dev/null; then
    COMPOSE_CMD="docker-compose"
    if ! command -v docker-compose &> /dev/null; then
        echo "❌ Docker Compose is not installed"
        echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
        exit 1
    fi
fi

echo "✓ Docker found"
echo "✓ Docker Compose found"
echo ""

# Create .env if not exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    if [ -f .env.example ]; then
        cp .env.example .env
    elif [ -f .env.exemple ]; then
        cp .env.exemple .env
    else
        echo "❌ No .env template found"
        exit 1
    fi
    
    # Generate random secrets
    JWT_SECRET=$(openssl rand -base64 32)
    sed -i "s/your_jwt_secret_here/$JWT_SECRET/g" .env
    
    echo "✓ .env file created"
    echo ""
    echo "⚠️  IMPORTANT: Please edit .env file with your Discord bot credentials"
    echo ""
fi

# Create data directories
echo "📁 Creating data directories..."
mkdir -p data letsencrypt logs
chmod -R 755 data letsencrypt logs

echo "✓ Directories created"
echo ""

# Pull images
echo "📦 Pulling Docker images..."
$COMPOSE_CMD pull

echo "✓ Images pulled"
echo ""

# Build containers
echo "🔨 Building Andaflare..."
$COMPOSE_CMD build

echo "✓ Build complete"
echo ""

# Start services
echo "🚀 Starting Andaflare..."
$COMPOSE_CMD up -d

echo ""
echo "✅ Installation complete!"
echo ""
echo "🌐 Access your Andaflare dashboard:"
echo "   http://$(hostname -I | awk '{print $1}'):81"
echo ""
echo "📚 Default credentials:"
echo "   Email: admin@andaflare.local"
echo "   Password: changeme"
echo ""
echo "⚠️  IMPORTANT:"
echo "   1. Change the default password immediately"
echo "   2. Configure Discord bot in .env file"
echo "   3. Point your domains' DNS to this server"
echo ""
echo "📖 Documentation: https://github.com/sudo-tool/andaflare"
echo ""
echo "🛡️  DDoS Protection is active!"
echo ""
