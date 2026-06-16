# 🚀 Andaflare Quick Start

## Installation en 3 minutes

### Option 1 : Docker (Recommandé)

```bash
# 1. Cloner le repo
git clone https://github.com/sudo-tool/andaflare
cd andaflare

# 2. Configurer
cp .env.example .env
nano .env  # Éditer les variables

# 3. Installer
chmod +x install.sh
sudo ./install.sh
```

**C'est tout ! 🎉**

Accédez à : `http://votre-ip:81`

### Option 2 : Manuel

```bash
# Backend
cd backend
npm install
npm start

# Frontend (autre terminal)
cd frontend
npm install
npm run build

# Redis
docker run -d -p 6379:6379 redis:7-alpine
```

## Configuration Discord Bot

1. Créer un bot sur https://discord.com/developers/applications
2. Activer les **Slash Commands**
3. Copier le **Token**
4. Inviter le bot sur votre serveur
5. Copier l'**ID du canal**
6. Éditer `.env` :

```env
DISCORD_BOT_TOKEN=votre_token_ici
DISCORD_CHANNEL_ID=id_du_canal
DISCORD_ADMIN_IDS=votre_user_id,autre_user_id
```

7. Redémarrer : `docker-compose restart andaflare`

## Ajouter un Domaine Protégé

1. Dashboard → **Proxy Hosts** → **Add Proxy Host**
2. Remplir :
   - Domain: `example.com`
   - Forward IP: `192.168.1.100`
   - Forward Port: `80`
3. Activer **SSL** (optionnel)
4. Activer **DDoS Protection** ✅
5. Sauvegarder

## Configurer le DNS

```
Type A:  example.com      → IP_DE_VOTRE_SERVEUR
Type A:  www.example.com  → IP_DE_VOTRE_SERVEUR
```

## Mode Attaque

### Activation Manuelle

```bash
# Via Dashboard
Proxy Hosts → Click "Attack Mode" sur le domaine

# Via Discord
/attack example.com on
```

### Désactivation

```bash
# Via Dashboard
Click "Disable Attack Mode"

# Via Discord
/attack example.com off
```

## Commandes Discord

```
/banip 1.2.3.4 reason:"Attaque DDoS"
/unbanip 1.2.3.4
/banlist
/stats
/attack example.com on|off
```

## Vérification

```bash
# Vérifier les services
docker-compose ps

# Voir les logs
docker-compose logs -f andaflare

# Tester le CAPTCHA
curl http://votre-domaine  # Si en mode attaque, redirige vers CAPTCHA
```

## Dépannage

### Le CAPTCHA ne s'affiche pas

```bash
# Vérifier Redis
docker-compose logs redis

# Vérifier les logs Andaflare
docker-compose logs andaflare | grep -i captcha
```

### Le bot Discord ne répond pas

```bash
# Vérifier le token
docker-compose exec andaflare env | grep DISCORD

# Voir les logs Discord
docker-compose logs andaflare | grep -i discord
```

### Mode attaque ne fonctionne pas

```bash
# Vérifier Redis
docker-compose exec redis redis-cli KEYS "attack:*"

# Vérifier les seuils
docker-compose exec andaflare env | grep THRESHOLD
```

## Mise à jour

```bash
git pull
docker-compose build
docker-compose up -d
```

## Désinstallation

```bash
docker-compose down -v
rm -rf data letsencrypt logs
```

## Support

- **Issues** : https://github.com/sudo-tool/andaflare/issues
- **Docs** : https://github.com/sudo-tool/andaflare/tree/main/docs
- **Discord** : [Join our community](https://discord.gg/andaflare)

---

**Fait avec 🛡️ par Andaflare Team**
