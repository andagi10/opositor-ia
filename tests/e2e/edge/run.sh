cd /home/claude/e2e
K=$(node -e "const k=require('./keys.json');process.stdout.write(k.SERVICE+' '+k.ANON)")
SERVICE=${K% *}; ANON=${K#* }
DENO_DIR=/home/claude/e2e/.deno SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=$SERVICE SUPABASE_ANON_KEY=$ANON ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:54400 \
  exec ./node_modules/.bin/deno run -A --import-map edge/import_map.json edge/main.ts
