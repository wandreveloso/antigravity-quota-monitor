#!/usr/bin/env bash
set -e

echo "=========================================================="
echo "🚀 Antigravity Quota & Context Monitor - Deploy & Release"
echo "   Desenvolvido por Wandré Veloso (@wandreveloso)"
echo "=========================================================="
echo ""

cd "$(dirname "$0")"

# 1. Compilar e empacotar
echo "📦 1. Compilando e gerando pacote VSIX..."
npm run compile
npx vsce package --no-dependencies --allow-missing-repository --allow-star-activation

VSIX_FILE=$(ls -t *.vsix | head -n 1)
VERSION=$(node -p "require('./package.json').version")

echo "✅ Pacote gerado com sucesso: $VSIX_FILE (Versão $VERSION)"
echo ""

# 2. Publicação no GitHub (Repositório & Release)
echo "----------------------------------------------------------"
echo "🌐 2. Publicação no GitHub (Releases & Portfólio)"
echo "----------------------------------------------------------"

if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "Autenticação GitHub detectada!"
  
  # Cria o repositório remoto caso não exista
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "Criando repositório remoto público no GitHub..."
    gh repo create "wandreveloso/antigravity-quota-monitor" --public --source=. --remote=origin --push || true
  else
    git push -u origin main --tags || true
  fi

  # Cria a release pública com o .vsix anexado
  echo "Criando Release v$VERSION no GitHub..."
  gh release create "v$VERSION" "$VSIX_FILE" \
    --title "Antigravity Quota Monitor v$VERSION" \
    --notes "Release oficial da extensão Antigravity Quota & Context Monitor v$VERSION para o Google Antigravity IDE (v1.107.0+)." \
    --target main || echo "Release já existente ou atualizada."
  
  echo "✅ Release no GitHub concluída: https://github.com/wandreveloso/antigravity-quota-monitor/releases"
else
  echo "ℹ️  GitHub CLI não autenticado ainda."
  echo "   Para publicar no GitHub com 1 comando, execute:"
  echo "     gh auth login"
  echo "   E depois rode novamente este script: ./deploy.sh"
fi

echo ""

# 3. Publicação no Visual Studio Marketplace
echo "----------------------------------------------------------"
echo "🏪 3. Publicação no Visual Studio Marketplace (Microsoft)"
echo "----------------------------------------------------------"

if [ -n "$VSCE_PAT" ]; then
  echo "PAT detectado em \$VSCE_PAT. Publicando no Marketplace..."
  npx vsce publish -p "$VSCE_PAT"
  echo "✅ Publicado no Visual Studio Marketplace!"
else
  echo "ℹ️  Para publicar no Visual Studio Marketplace:"
  echo "   1. Obtenha seu token (PAT) em https://dev.azure.com (Escopo: Marketplace -> Manage)"
  echo "   2. Execute:"
  echo "      VSCE_PAT=seu_token_aqui ./deploy.sh"
  echo "      (Ou: npx vsce login wandreveloso && npx vsce publish)"
fi

echo ""

# 4. Publicação no Open VSX Registry
echo "----------------------------------------------------------"
echo "🪐 4. Publicação no Open VSX Registry (Eclipse Foundation)"
echo "----------------------------------------------------------"

if [ -n "$OVSX_PAT" ]; then
  echo "Token Open VSX detectado em \$OVSX_PAT. Publicando..."
  npx ovsx publish "$VSIX_FILE" -p "$OVSX_PAT"
  echo "✅ Publicado no Open VSX Registry!"
else
  echo "ℹ️  Para publicar no Open VSX Registry:"
  echo "   1. Obtenha seu token em https://open-vsx.org/user-settings/tokens"
  echo "   2. Execute:"
  echo "      OVSX_PAT=seu_token_aqui ./deploy.sh"
fi

echo ""
echo "=========================================================="
echo "🎉 Processo de distribuição concluído!"
echo "=========================================================="
