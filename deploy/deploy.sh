#!/usr/bin/env bash
# Runs on the EC2 server (through sitelog-deploy <tag>): secrets, migrations, then the new containers.
set -euo pipefail
TAG="$1"
cd /opt/sitelog
source instance.env

# 1. Secrets → secrets.env (readable by root only). Never in the image, never in git.
umask 077
{
  # Every parameter under /sitelog/<env>/ becomes NAME=value.
  aws ssm get-parameters-by-path --region "$AWS_REGION" --path "/sitelog/$ENV_NAME" --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text |
    while IFS=$'\t' read -r name value; do
      echo "${name##*/}=$value"
    done
  # The database password RDS generated, turned into one connection URL.
  aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_SECRET_ARN" \
    --query SecretString --output text |
    jq -r '"DATABASE_URL=postgres://\(.username):\(.password | @uri)@\(.host):\(.port)/\(.dbname)"'
} > secrets.env

# 2. Migrations with the new image, before any new code serves requests.
export IMAGE="$ECR_REPOSITORY:$TAG"
export AWS_REGION ENV_NAME API_DOMAIN
docker compose run --rm --no-deps api node dist/migrate.js

# 3. Replace the containers (a few seconds of downtime) and wait until the API is healthy.
docker compose up -d --remove-orphans
for attempt in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q api)")
  if [ "$status" = "healthy" ]; then
    echo "deployed $TAG"
    docker image prune -af --filter "until=168h" > /dev/null
    exit 0
  fi
  sleep 2
done
echo "api did not become healthy" >&2
docker compose logs --tail 50 api >&2
exit 1
