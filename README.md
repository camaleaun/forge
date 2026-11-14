# forge

Gerador de apps nativos minúsculos a partir de uma única fonte: `app.json` (tokens, janela, widgets, comandos de CLI) e `index.ts` (comportamento).
Alvo da v1: macOS + CLI, só Label e Button. Linux, Windows e Web vêm depois.

Status: em construção (M1 em andamento). O plano e as decisões estão em [forge-rag](https://github.com/camaleaun/forge-rag) (privado).

## Regras do projeto
- Sem pacotes npm nas ferramentas nem nos programas gerados (o `package.json` só marca `"type": "module"` e o script de teste).
- Node 24 roda os `.ts` direto, sem build e sem checagem de tipos. Testes com o runner embutido: `npm test` (`node --test`).
- TDD/BDD: cada comportamento nasce de um teste Given/When/Then visto falhando antes do código.

## Licença
MIT
