# STATUS · Gerador Piá (app selfie → traço do Piá)

Atualizado em 17/09/2026.

## O que é
Página web pra mandar pro programador hospedar. A pessoa tira selfie ou escolhe foto, o backend chama o Gemini com o character sheet do Piá + prompt, e devolve a pessoa no traço do Piá com a camiseta preta PRODUÇÃO BOLD / PIX2 / tif. Fundo: bastidor de set de cinema.

## Entregue (v1)
- `frontend/index.html`: página completa, um arquivo. Hero com o Piá no set (gerado no Nano Banana 2 via Higgsfield, prompt em `referencias/prompt_hero_nano_banana.txt`), três logos, fluxo selfie (getUserMedia) ou galeria, loading, resultado antes/depois, baixar, compartilhar.
- `backend/server.js`: Node/Express, rota `POST /api/transformar`, rate limit por IP, modo MOCK. Prompt em `backend/prompt_pia.txt`, sheet em `backend/character_sheet_pia.jpg`.
- `README.md`: instruções pro programador (instalar, chave, modelo, hospedagem, CORS, timeout).
- Testado no navegador em modo MOCK (desktop e mobile). Fluxo completo OK.

## NÃO testado
- Geração real no Gemini: não há chave na máquina. O programador precisa colocar a `GEMINI_API_KEY` e rodar 5 selfies pra comparar `gemini-2.5-flash-image` x `gemini-3-pro-image-preview` e ajustar o prompt se a camiseta ou o rosto não vierem bem.

## Onde estão os originais
- Character sheet: `Desktop/Mesa - MacBook Pro de Murillo - 1/PRODUÇÃO BOLD/APP GERADOR/04-character-sheet- PIA-TIF_BOLD`
- Logos: `Downloads/PRODUÇÃO BOLD/LOGO PIX2` e `LOGO PRODUÇAO BOLD` (o logo da Bold foi recortado do 03.png; pedir o vetor oficial pro programador trocar)
- Rosto oficial do Piá (camiseta Paraná, colete verde): `Downloads/PRODUÇÃO BOLD/ROSTO PIA`

## Pra rodar local em mock
```
cd backend && MOCK=1 PORT=3017 node server.js
```
(também está em `Documents/CLAUDE/.claude/launch.json` como `pia-gerador-mock`)
