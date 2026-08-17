#!/usr/bin/env bash
#
# Deploy to Vercel: ./scripts/deploy.sh
#
# Copies the environment from .env.local into the Vercel project and deploys.
# Secrets are piped on stdin, never passed as arguments, so they don't appear
# in the process list or your shell history.
#
# Run `vercel login` first — that step is interactive and cannot be scripted.
#
# Safe to re-run: existing variables are removed and re-added, and the final
# deploy is a normal production deploy.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "  .env.local not found. Run: npm run setup" >&2
  exit 1
fi

if ! npx vercel whoami >/dev/null 2>&1; then
  echo
  echo "  Not logged in to Vercel. Run this first:"
  echo
  echo "      npx vercel login"
  echo
  exit 1
fi

echo
echo "  Linking the project (accept the prompts, or pick an existing project)…"
npx vercel link

# Read a single value out of .env.local without echoing it.
read_env() {
  local key="$1"
  sed -n "s/^${key}=//p" .env.local | head -1 | sed -e 's/^"//' -e 's/"$//'
}

# Variables the deployment needs. GOOGLE_* are optional.
REQUIRED=(DATABASE_URL DIRECT_DATABASE_URL APP_PASSWORD AUTH_SECRET OPENAI_API_KEY CRON_SECRET)
OPTIONAL=(OPENAI_MODEL_CHEAP OPENAI_MODEL_STRONG OPENAI_MONTHLY_BUDGET_USD OPENAI_BASE_URL GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)

echo
echo "  Pushing environment variables…"

push() {
  local key="$1" value="$2"
  [ -z "$value" ] && return 0
  # Remove first so re-running doesn't error on an existing variable.
  npx vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | npx vercel env add "$key" production >/dev/null 2>&1
  echo "    ✓ $key"
}

for key in "${REQUIRED[@]}"; do
  value="$(read_env "$key")"
  if [ -z "$value" ] || [[ "$value" == REPLACE_ME* ]]; then
    echo "    ✗ $key is missing from .env.local" >&2
    exit 1
  fi
  push "$key" "$value"
done

for key in "${OPTIONAL[@]}"; do
  push "$key" "$(read_env "$key")"
done

echo
echo "  Deploying…"
DEPLOY_URL="$(npx vercel --prod --yes | tail -1)"

echo
echo "  Deployed: $DEPLOY_URL"

# NEXT_PUBLIC_APP_URL and the Gmail redirect can only be set once the URL is
# known, so they need a second pass and a redeploy.
echo
echo "  Setting the app URL and redeploying…"
push NEXT_PUBLIC_APP_URL "$DEPLOY_URL"
push GOOGLE_REDIRECT_URI "$DEPLOY_URL/api/gmail/callback"
npx vercel --prod --yes >/dev/null

CRON_SECRET_VALUE="$(read_env CRON_SECRET)"

cat <<EOF

  Done.

    App          $DEPLOY_URL
    Sign in      the APP_PASSWORD from your .env.local
    Health       $DEPLOY_URL/api/health

  Next:

    1. GitHub → repo → Settings → Secrets and variables → Actions, add:
         APP_URL      $DEPLOY_URL
         CRON_SECRET  (the value in your .env.local)

    2. If you want Gmail on the deployment, add this to the OAuth client's
       authorized redirect URIs in Google Cloud Console:
         $DEPLOY_URL/api/gmail/callback

    3. Trigger a first discovery run:
         curl -H "Authorization: Bearer \$CRON_SECRET" $DEPLOY_URL/api/cron/discover

EOF
