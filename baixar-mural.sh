#!/usr/bin/env bash
# Baixa as imagens do mural do Gerador Piá para uma pasta local.
#
#   ./baixar-mural.sh                  -> baixa para ~/Downloads/mural-pia
#   ./baixar-mural.sh /outro/caminho   -> baixa para onde você mandar
#
# Usa o HTTP do próprio site: não depende do túnel SSH do Fly, que tem
# oscilado. Limitação: a rota /api/galeria devolve no máximo 200 itens, então
# acima disso use o método do tar (veja o README).
set -euo pipefail

BASE="${PIA_URL:-https://pia-hidden-haze-4185.fly.dev}"
DESTINO="${1:-$HOME/Downloads/mural-pia}"

mkdir -p "$DESTINO"
echo "Origem:  $BASE"
echo "Destino: $DESTINO"

LISTA=$(curl -fsS -m 30 "$BASE/api/galeria?limit=200")
TOTAL=$(printf '%s' "$LISTA" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')
IDS=$(printf '%s' "$LISTA" | python3 -c 'import sys,json; [print(i["id"]) for i in json.load(sys.stdin)["itens"]]')

BAIXADOS=0; PULADOS=0; FALHOS=0
for id in $IDS; do
  arq="$DESTINO/$id.jpg"
  if [ -s "$arq" ]; then PULADOS=$((PULADOS+1)); continue; fi
  if curl -fsS -m 60 "$BASE/galeria/full/$id.jpg" -o "$arq"; then
    BAIXADOS=$((BAIXADOS+1))
  else
    rm -f "$arq"; FALHOS=$((FALHOS+1)); echo "  falhou: $id" >&2
  fi
done

echo "no mural: $TOTAL | baixados agora: $BAIXADOS | ja existiam: $PULADOS | falhas: $FALHOS"
[ "$TOTAL" -gt 200 ] && echo "AVISO: o mural tem $TOTAL itens, mas a API lista no maximo 200. Use o metodo do tar."
echo "Arquivos em: $DESTINO"
