# Colmeia de subagentes

A Colmeia é a equipe especializada do Ares. O Ares continua sendo o gerente: ele decide quando delegar, coleta material local/web, recebe relatórios técnicos e sintetiza a resposta final para o usuário. Os especialistas NUNCA falam direto com o usuário e NUNCA escrevem arquivos — quem aplica mudanças continua sendo o Ares (com `codigo.editar`/`codigo.criar`/`codigo.patch.*`) ou o coder autônomo (`codigo.projeto`).

## Especialistas

- **Atena (`subagente.pesquisar`)** — investigação web/documentação. Recebe buscas, notícias recentes e página indicada por URL. Devolve fatos verificáveis com fonte e data, em blocos `[RESUMO]`, `[LINHA DO TEMPO]`, `[FATOS]`, `[INCERTEZAS]`, `[FONTES]`.
- **Hefesto (`subagente.construir`)** — **tech-lead**. NÃO escreve o projeto inteiro: ele entrega um BRIEFING técnico em blocos `[ESCOPO]`, `[ARQUIVOS]`, `[PASSOS]`, `[TRECHOS]` (opcional), `[RISCOS]`, `[VALIDAR]`. O Ares usa esse briefing para aplicar passo-a-passo OU para alimentar o coder autônomo.
- **Têmis (`subagente.auditar`)** — auditoria. Recebe diff POR ARQUIVO + outline + checagens reais. Abre com `[VEREDITO]` (APROVADO/REPROVADO), seguido de `[RESUMO]` e `[PROBLEMAS]` (arquivo:linha + gravidade + correção sugerida).
- **Prometeu (`subagente.depurar`)** — depuração. Recebe logs de erro/stack trace, contexto de código nos pontos exatos do erro (±30 linhas) e diagnóstico do projeto. Devolve `[CAUSA RAIZ]`, `[EVIDÊNCIA]`, `[CORRECAO]` (passos cirúrgicos ANTES/DEPOIS), `[HIPOTESES DESCARTADAS]` e `[VALIDAR]`. O Ares aplica a correção imediatamente e roda o comando de validação na mesma rodada.

## Hefesto vs Coder Autônomo (separação nítida)

| Situação | Use |
|---|---|
| Mudança pequena/cirúrgica, caminho claro | `codigo.editar` direto (sem Colmeia) |
| Mudança multiarquivo com plano claro | `codigo.projeto` (coder autônomo) |
| Decidir entre abordagens, mapear arquivos, avaliar riscos antes de mexer | `subagente.construir` (Hefesto) |
| Validar o que mudou | `subagente.auditar` (Têmis) |

Regra de ouro: **nunca chame Hefesto E `codigo.projeto` com o mesmo objetivo**. Hefesto planeja; o coder autônomo executa. Após o briefing do Hefesto, o Ares escolhe um dos dois caminhos de execução.

## Fluxo recomendado

1. O Ares identifica a necessidade: informação externa, decisão de projeto ou auditoria.
2. O Ares chama o subagente correto e mostra o status na aba Escritório via `agent:hive-update`.
3. O subagente devolve relatório técnico para o Ares, nunca diretamente para o usuário.
4. O Ares usa o relatório para agir ou bloquear explicitamente:
   - Atena: achado principal, datas, fontes e incertezas.
   - Hefesto: escopo, arquivos, validação; decide entre aplicar passo-a-passo ou delegar ao coder autônomo.
   - Têmis: veredito, problemas reais, gravidade e correção sugerida.
   - Prometeu: causa raiz, correção mínima e comando de validação.
5. Se o Ares prometer usar um especialista mas não emitir a ação JSON, o runtime força uma rodada corretiva. Se ainda não houver ação real, a fala final declara o bloqueio em vez de afirmar execução.

## EvidencePackage (pacotes de evidência tipados)

Cada subagente recebe um `EvidencePackage` com seções rotuladas em vez de uma string truncada por chars. O renderer aloca orçamento por seção com base em `priority` (1 essencial, 2 útil, 3 opcional) e `minChars` — seções essenciais recebem cota mínima primeiro; sobra é distribuída com peso por prioridade; truncamento sempre preserva fronteira de linha.

Seções típicas:

- **Atena**: `Metadados da pesquisa`, `Resultados de busca`, `Resultados focados em recência`, `Notícias recentes`, `Conteúdo da página <url>`.
- **Hefesto**: `Workspace <nome>`, `Estado Git` (status + diff --stat), `Arquivos relevantes ao objetivo (outlines)`, `Árvore de arquivos do projeto`. A relevância vem do ranking por tokens do objetivo + arquivos modificados no git status.
- **Têmis**: `Diagnóstico de <projeto>` (typecheck/lint/test), `git status --short`, `Mudanças por arquivo (N)` — cada arquivo alterado vira um bloco próprio com `outline` + `diff`, sem corte único por chars.

Falhas na coleta (offline, timeout, sem diff) viram `notes` no pacote em vez de quebrar a tarefa.

## Contexto orientado a tarefa

`buildTaskContext` (alias retrocompatível: `compactSubagentContext`) empacota o que o especialista precisa para entender o turno sem ver a conversa inteira:

- Contexto direto do passo atual (passado pela ação `subagente.*`).
- Preferências de código persistidas (`codingPreferencesSummary`).
- Estado operacional recente: último arquivo editado, último comando OK.
- Resumo da conversa e amostragem de até 8 mensagens recentes (filtradas por tamanho útil).

## Protocolo do relatório

O sistema de prompts pede que o subagente abra blocos rotulados (`[ESCOPO]`, `[ARQUIVOS]`, `[VEREDITO]`...). O Ares pode usar `parseReportTags(report)` para extrair veredito, lista de arquivos, riscos, `[RESUMO]`, `[CAUSA RAIZ]`, `[VALIDAR]` e `[PROBLEMAS]` de forma testável — sem depender de regex no LLM. Quando o template falta, a função devolve um objeto vazio (best-effort).

### Validação de blocos obrigatórios (rodada corretiva)

Cada perfil declara `requiredTags` — os blocos que o relatório PRECISA conter (Atena: `RESUMO`+`FONTES`; Hefesto: `ESCOPO`+`PASSOS`+`VALIDAR`; Têmis: `VEREDITO`; Prometeu: `CAUSA RAIZ`+`CORRECAO`+`VALIDAR`). Se o modelo esquecer algum, `executeSubagentTask` faz **uma** rodada corretiva pedindo a reescrita completa; a reescrita só substitui o original se reduzir os blocos faltantes (`missingReportTags`, tolerante a acento/caixa e a rótulos sem colchetes). Sem isso, um relatório fora do template quebrava o parse downstream em silêncio e degradava a síntese do Ares.

### Relato falado (modo voz)

Em voz+código, o resumo imediato falado usa o conteúdo REAL do relatório: Atena fala o `[RESUMO]`, Hefesto fala `[ESCOPO]` e `[VALIDAR]`, Prometeu fala `[CAUSA RAIZ]` e Têmis reprovada adianta o primeiro problema de gravidade alta — em vez dos genéricos "concluiu a pesquisa"/"reprovou as alterações". A fala final passa pelo ledger de evidências do turno, então o Ares não diz que aplicou ou validou uma recomendação sem ferramenta executada.

## Guarda determinística de delegação

Quando o LLM principal promete chamar um especialista mas esquece a ação JSON (`subagente.*`), `inferPromisedHiveAction` cumpre a promessa. A regra é estrita:

1. Verbo de **delegação clara**: `vou pedir/chamar/acionar/...`, `peço para`, `agora com a/o`, `Hefesto vai`, `Têmis fará`, `Atena investiga`.
2. **Nome** do especialista (`Atena`/`Hefesto`/`Têmis`).
3. Verbo de **domínio** compatível com aquele especialista (pesquisa/construção/auditoria).

Faltando qualquer um dos três, a inferência é descartada. Verbos de leitura genéricos (`vou ler o arquivo`) não disparam.

## Dados coletados automaticamente

- **Atena**: `webSearch`, busca focada em notícias recentes, Google News RSS, leitura proativa das top-2 páginas dos resultados e `readPage` quando há URL.
- **Hefesto**: `summarizeCodeWorkspace`, `git status` + `diff --stat`, `outlineCodeFile` para os arquivos mais relevantes ao objetivo (ranking por tokens + arquivos do git status).
- **Têmis**: `diagnoseProject` (typecheck/lint/test quando permitidos), `git status --short`, e para cada arquivo alterado um bloco `outline + diff`.
- **Prometeu**: logs de erro da ação, `diagnoseProject`, `extractErrorLocations` (arquivo:linha do stack trace confirmado contra o workspace) com `readCodeContext` ±30 linhas em cada ponto, e outlines dos demais arquivos suspeitos.

## Higiene de despacho

Ações de consulta EXATAMENTE duplicadas na mesma rodada (o modelo às vezes emite o mesmo `subagente.*` duas vezes) são removidas por `dedupeActions` antes do despacho — uma chamada de Colmeia duplicada custa uma rodada inteira de LLM sem ganho.

Ações independentes podem ser despachadas em paralelo na mesma rodada. O heartbeat global usa o rótulo da frente ativa mais recente e mantém a voz viva enquanto subagentes, testes e leituras rodam juntos. O modo programador também tem limite maior de rodadas encadeadas que conversa comum; ao atingir o limite com ferramentas pendentes, o Ares registra o bloqueio e relata o que faltou, sem descartar ações em silêncio.

## Regras de segurança

- Subagentes não executam mutações. Eles apenas produzem relatórios.
- O Ares aplica qualquer alteração usando `codigo.criar`, `codigo.editar`, `codigo.patch.*` ou comandos permitidos. Tarefas multiarquivo end-to-end vão para `codigo.projeto`.
- Comandos fora da allowlist continuam exigindo autorização do usuário.
- Relatórios e pacotes de evidência são truncados/orçados antes de voltar ao contexto para evitar explosão de tokens.

## Arquivos principais

- `src/main/agent/hive.ts` — coletores especializados (`gatherResearcherEvidence`, `gatherEngineerEvidence`, `gatherAuditorEvidence`, `gatherDebuggerEvidence`), `buildTaskContext`, `inferPromisedHiveAction`, `hiveFollowupInstruction`, `proactiveCodeFollowup`.
- `src/main/tools/hiveCommands.ts` — registro das ferramentas `subagente.*` (progresso, heartbeat e status da Colmeia via dispatcher).
- `src/main/subagents/profiles.ts` — prompts, temperaturas e `requiredTags` dos especialistas.
- `src/main/subagents/executor.ts` — `executeSubagentTask` (com rodada corretiva), `buildTaskPrompt`, `parseReportTags`, `missingReportTags`, `summarizeReport`.
- `src/main/subagents/evidence.ts` — `renderEvidencePackage`, `truncateSmart`, `evidenceOf`, `pickRelevantFiles`, `parseGitStatusFiles`.
- `src/main/subagents/types.ts` — `EvidencePackage`, `EvidenceSection`, `SubagentTask`, `SubagentReportTags`, `SubagentProfile`.
- `src/renderer/components/HiveDashboard.tsx` — visualização da equipe no Escritório.
