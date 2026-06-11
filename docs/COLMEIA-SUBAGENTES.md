# Colmeia de subagentes

A Colmeia e a equipe especializada do Ares. O Ares continua sendo o gerente: ele decide quando delegar, coleta material local/web, recebe relatorios tecnicos e sintetiza a resposta final para o usuario.

## Especialistas

- **Atena (`subagente.pesquisar`)**: investigacao web/documentacao. Recebe buscas, noticias recentes e pagina indicada por URL. Deve devolver fatos verificaveis, datas, incertezas e fontes.
- **Hefesto (`subagente.construir`)**: planejamento de implementacao. Recebe contexto do workspace, linguagens, scripts, saude do projeto, `git status` e `diff --stat`. Deve devolver plano por arquivo, ordem de aplicacao e validacao.
- **Temis (`subagente.auditar`)**: auditoria de qualidade. Recebe diagnostico real do projeto, checks disponiveis, `git status` e `git diff` truncado. Deve abrir com veredito `APROVADO` ou `REPROVADO` e listar somente problemas reais.

## Fluxo recomendado

1. O Ares identifica a necessidade: informacao externa, plano de codigo ou auditoria.
2. O Ares chama o subagente correto e mostra o status na aba Escritorio via `agent:hive-update`.
3. O subagente devolve relatorio tecnico para o Ares, nunca diretamente para o usuario.
4. O Ares sintetiza a resposta final com instrucao especifica por agente:
   - Atena: achado principal, datas, fontes e incertezas.
   - Hefesto: plano por arquivos, ordem de aplicacao e validacao.
   - Temis: veredito, problemas reais, gravidade e correcao sugerida.
5. Em tarefas grandes de codigo, o fluxo ideal e: Atena pesquisa se houver duvida externa, Hefesto desenha a mudanca, Ares aplica com ferramentas de codigo, Temis audita.

## Dados coletados automaticamente

- **Atena**: `webSearch`, busca focada em noticias recentes, Google News RSS e `readPage` quando ha URL.
- **Hefesto**: `summarizeCodeWorkspace`, health do projeto, scripts, arquivos relevantes, `git status --short` e `git diff --stat`.
- **Temis**: `diagnoseProject`, resultados de typecheck/lint/test quando disponiveis, hints, `git status --short` e `git diff` para revisar as mudancas.

## Regras de seguranca

- Subagentes nao executam mutacoes. Eles apenas produzem relatorios.
- O Ares aplica qualquer alteracao usando `codigo.criar`, `codigo.editar`, `codigo.patch.*` ou comandos permitidos.
- Comandos fora da allowlist continuam exigindo autorizacao do usuario.
- Relatorios sao truncados antes de voltar ao contexto para evitar explosao de tokens.

## Arquivos principais

- `src/main/agent.ts`: roteamento da ferramenta `subagente.*`, coleta de evidencias e instrucoes de follow-up.
- `src/main/subagents/profiles.ts`: prompts e temperaturas dos especialistas.
- `src/main/subagents/executor.ts`: execucao do subagente, status da Colmeia e truncamento do relatorio.
- `src/renderer/components/HiveDashboard.tsx`: visualizacao da equipe no Escritorio.
