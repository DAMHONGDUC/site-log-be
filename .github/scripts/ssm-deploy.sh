#!/usr/bin/env bash
# Runs `sitelog-deploy <tag>` on the server of one environment through SSM, and waits for it.
set -euo pipefail
ENV_NAME="$1"
TAG="$2"

INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:sitelog:env,Values=$ENV_NAME" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$INSTANCE_ID" = "None" ]; then
  echo "No running server tagged sitelog:env=$ENV_NAME" >&2
  exit 1
fi

COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --comment "deploy $TAG" \
  --parameters "{\"commands\":[\"/usr/local/bin/sitelog-deploy $TAG\"]}" \
  --query Command.CommandId --output text)
echo "Deploying $TAG to $INSTANCE_ID (command $COMMAND_ID)"

# Up to 10 minutes.
for attempt in $(seq 1 120); do
  STATUS=$(aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
    --query Status --output text 2>/dev/null || echo Pending)
  if [ "$STATUS" = "Success" ]; then
    break
  fi
  if [ "$STATUS" = "Failed" ] || [ "$STATUS" = "Cancelled" ] || [ "$STATUS" = "TimedOut" ]; then
    break
  fi
  sleep 5
done

aws ssm get-command-invocation --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text
if [ "$STATUS" != "Success" ]; then
  echo "Deploy ended with status $STATUS" >&2
  exit 1
fi
