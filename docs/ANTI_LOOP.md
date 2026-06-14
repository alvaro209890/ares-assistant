# Prevenção de Loops Infinitos (Guarda Determinística)

Este documento descreve as medidas arquiteturais implementadas para evitar loops infinitos no fluxo agêntico do Ares, especialmente ao usar a Colmeia (Atena, Hefesto, Prometeu, Têmis).

## 1. Isolamento de Contexto na Inferência
O Ares possui uma funcionalidade de **Guarda Determinística** (`inferPromisedHiveAction` e `needsPromisedCodeCorrection`) que converte promessas feitas pelo modelo em fala natural em ações JSON reais, caso o modelo esqueça de emiti-las.

**Regra de Ouro:** A inferência deve SEMPRE usar apenas a fala do **turno atual** (`envN.fala`) e nunca a transcrição acumulada (`fala` ou `visibleTranscript`).
- Se usarmos a transcrição acumulada, um anúncio de ação da rodada 1 (ex: "Vou pedir para o Prometeu...") será detectado novamente na rodada 2 como uma nova promessa, gerando um loop infinito de chamadas ao subagente.

## 2. Rigor nas Regexes de Delegação
As regexes que detectam intenção de acionar a Colmeia (`DELEGATION_RE` em `src/main/agent/hive.ts`) e intenção de programar (`CODE_PROMISE_RE` em `src/main/voiceCode.ts`) devem usar limites de palavras (`\b`) em todos os verbos e nomes de agentes.

**Por que:** Sem o `\b`, o sistema pode confundir relatórios de ações passadas (ex: "Prometeu **analisou**") com intenções futuras (ex: "Prometeu **analisa**").

## 3. Fluxo de Execução no `agent.ts`
No loop de ferramentas (`runTurn`), as validações de promessa devem ser feitas após cada `streamTurn` usando o envelope fresco retornado pelo modelo:

```typescript
const inferredHiveN = inferPromisedHiveAction(envN.fala || '', userText, envN.acoes)
if (inferredHiveN) {
  envN.acoes = [...envN.acoes, inferredHiveN]
}
```

## 4. Testes de Regressão
Sempre que alterar o fluxo de voz ou orquestração, verifique os logs para garantir que a mesma ação não está sendo emitida múltiplas vezes no mesmo turno com a nota `colmeia corrigida: promessa convertida em ação real`.
