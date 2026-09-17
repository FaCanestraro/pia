# STATUS · Gerador Piá (app selfie → traço do Piá)

Atualizado em 17/09/2026.

## O que é
Página web pra mandar pro programador hospedar. A pessoa tira selfie ou escolhe foto, o backend chama o Gemini com o character sheet do Piá + prompt, e devolve a pessoa no traço do Piá com a camiseta preta PRODUÇÃO BOLD / PIX2 / tif. Fundo: bastidor de set de cinema.

## Entregue (v1)
- `frontend/index.html`: página completa, um arquivo. Hero com o Piá no set (gerado no Nano Banana 2 via Higgsfield, prompt em `referencias/prompt_hero_nano_banana.txt`), três logos, fluxo selfie (getUserMedia) ou galeria, loading, resultado antes/depois, baixar, compartilhar.
- `backend/server.js`: Node/Express, rota `POST /api/transformar`, rate limit por IP, modo MOCK. Prompt em `backend/prompt_pia.txt`, sheet em `backend/character_sheet_pia.jpg`.
- `README.md`: instruções pro programador (instalar, chave, modelo, hospedagem, CORS, timeout).
- Testado no navegador em modo MOCK (desktop e mobile). Fluxo completo OK.

## Testado com a API real (17/09/2026)
- `gemini-2.5-flash-image`: 11,4 s, resposta 2,8 MB. Camiseta preta e bastidor corretos, mas o logo saiu "BOIO".
- `gemini-3-pro-image-preview`: 24,7 s, resposta 812 KB. Selfie real ficou boa: traço, camiseta, fundo e identidade OK. **É o modelo em uso.**
- Ressalva: o logo da Bold sai redesenhado ("BOID"), não é o wordmark real. Modelo de imagem não reproduz logo — se precisar de fidelidade de marca, compositar o `logo_bold.png` por cima depois da geração.

## Mural (v2)
- `backend/galeria.js` + rotas `GET /api/galeria` e `DELETE /api/galeria/:id`, seção `#mural` no front com mosaico responsivo, lightbox e poll de 25 s.
- Testado em mock (vazio, 3 itens, 12 itens, desktop e mobile 390px, lightbox, ESC) e o caminho de gravação testado com PNG real do Gemini.
- Grava automaticamente, sem opt-in. `ADMIN_TOKEN` é a única via de remoção — definir antes de abrir ao público.
- Depende de disco persistente: **não funciona em Vercel serverless** sem trocar por object storage.

## Fila e limites (v3)
- Medido em produção: Gemini leva 20-22 s isolado e 84-91 s com três chamadas simultâneas na mesma chave. Não é o Fly nem o sharp — chamadas isoladas na mesma máquina voltaram a 20 s.
- Fila com `GEMINI_CONCURRENCY=2`, posição por ticket em `GET /api/fila`, indicador no loader.
- Cancelamento: cliente que desiste aborta a chamada ao Gemini e libera a vaga na hora.
- Freio trocado: cooldown por IP (15 s) + teto global por hora (300), porque cota por IP tranca evento com wifi compartilhado.
- Testado em mock: 6 simultâneas com concorrência 2 saíram em 3/3/6/6/9/9 s com a geração constante em 3 s; cooldown, limite global e abort verificados.

## Bloqueio de IP (17/09/2026)
- App ficou ~50 min sem gerar. Sintoma: `fetch failed` / Connect Timeout só para domínios Google; github e npm respondiam normal da mesma máquina.
- Causa: proteção anti-abuso do Google sobre o IP de egresso COMPARTILHADO do Fly. Não era cota, não era a chave, não era concorrência da API (10 simultâneas do meu Mac passaram em ~40s).
- Conserto: `fly ips allocate-egress --region gru` -> egress dedicado `209.71.74.130`. Primeira geração depois disso: 20,4s, zero retry.
- Lição: com egress compartilhado o limite seguro não é descobrível, porque depende do tráfego de terceiros no mesmo IP.

## NÃO testado
- Mural sob concorrência real (várias pessoas gerando ao mesmo tempo num evento).
- Deploy em qualquer plataforma: só rodou local.

## Onde estão os originais
- Character sheet: `Desktop/Mesa - MacBook Pro de Murillo - 1/PRODUÇÃO BOLD/APP GERADOR/04-character-sheet- PIA-TIF_BOLD`
- Logos: `Downloads/PRODUÇÃO BOLD/LOGO PIX2` e `LOGO PRODUÇAO BOLD` (o logo da Bold foi recortado do 03.png; pedir o vetor oficial pro programador trocar)
- Rosto oficial do Piá (camiseta Paraná, colete verde): `Downloads/PRODUÇÃO BOLD/ROSTO PIA`

## Pra rodar local em mock
```
cd backend && MOCK=1 PORT=3017 node server.js
```
(também está em `Documents/CLAUDE/.claude/launch.json` como `pia-gerador-mock`)
