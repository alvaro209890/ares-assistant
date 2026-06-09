# Memoria no Ares

A memoria do Ares guarda fatos duradouros sobre o usuario e sobre o trabalho em andamento. A implementacao atual foi inspirada no Hermes Agent oficial da NousResearch, especialmente nas ideias de memoria limitada por tamanho, contexto cercado, busca de sessoes e filtros contra prompt injection.

## O que deve ser salvo

O agente salva proativamente apenas fatos que devem continuar uteis em conversas futuras:

- perfil do usuario, cidade, rotina e restricoes;
- preferencias de resposta, tom, ferramentas e estilo de codigo;
- projetos recorrentes e convencoes do workspace;
- correcoes explicitas do usuario, como "nao me chame assim" ou "prefiro X".

O agente nao deve salvar tarefas temporarias, logs de terminal, resultado bruto de build, tokens, chaves, senhas, prompts ou instrucoes suspeitas. Quando o usuario pergunta sobre algo antigo, a primeira opcao deve ser `memoria.buscar`, nao criar uma memoria permanente nova.

## Estrutura dos fatos

Cada fato pode carregar:

- `target`: `user` para perfil/preferencias/rotina/restricoes/interesses, ou `memory` para notas de trabalho/projetos;
- `confidence`: numero de 0 a 1;
- `evidence`: pequenos trechos que justificam o fato;
- `review`: `ok`, `possible_conflict` ou `low_confidence`;
- `status`: `active` ou `pending`.

Fatos semelhantes sao deduplicados por similaridade de tokens. Se um fato automatico contradiz uma memoria existente, ele vira pendente com `review: "possible_conflict"` para revisao humana.

## Seguranca

Antes de salvar ou usar uma memoria no prompt, o Ares:

- remove caracteres invisiveis e tags `<memory-context>`;
- redige Bearer tokens, chaves comuns, senhas em atribuicoes e parametros sensiveis de URL;
- bloqueia padroes de prompt injection, exfiltracao de contexto, leitura de `.env`, comandos de envio para URL e acesso SSH;
- injeta a memoria dentro de `<memory-context>` com aviso de que aquilo e contexto recuperado, nao uma nova instrucao do usuario.

Os limites atuais sao pequenos de proposito: `user` usa ate 1800 caracteres e `memory` usa ate 3400 caracteres no resumo de contexto. O resumo mostra a ocupacao de cada bloco.

## Busca de sessoes

`memoria.buscar {consulta, limite?}` pesquisa conversas salvas localmente e retorna trechos com sessao, titulo, data, papel e score. Isso cobre pedidos como "lembra quando falamos sobre aquele bug?" sem poluir a memoria permanente.

## Arquivos relevantes

- `src/main/memory.ts`: sanitizacao, redacao, deteccao de risco, similaridade, conflito e bloco `<memory-context>`.
- `src/main/data.ts`: persistencia, deduplicacao, aprovacao de pendentes e busca de sessoes.
- `src/main/agent.ts`: prompts e ferramentas `memoria.salvar`, `memoria.remover` e `memoria.buscar`.
- `src/renderer/screens/Memory.tsx`: exibicao de alvo, confianca, conflito e evidencia.
- `tests/memory.test.ts`: cobertura de deduplicacao, bloqueio de injecao, conflito pendente, prompt cercado e busca de sessao.
