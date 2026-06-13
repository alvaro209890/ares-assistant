# Programacao Nativa no Ares

O modo programador do Ares e nativo. Ele trabalha diretamente no workspace permitido, sem delegar edicao, revisao, refatoracao ou teste para outro agente.

## Ferramentas

- `codigo.workspace {path?}`: resume projeto, stack, scripts, linguagens e estado Git.
- `codigo.listar {path?, filtro?}`: lista arquivos no workspace por padrão de busca (glob) sem precisar lê-los por completo.
- `codigo.esboco {path?, arquivo}`: gera um esboço/mapa do arquivo (funções, classes, tipos, interfaces e arrow functions) com as linhas iniciais.
- `codigo.buscar {path?, consulta, filtro?}`: busca texto ou simbolos.
- `codigo.ler {path?, arquivo, inicio?, linhas?}`: le trechos com numeros de linha.
- `codigo.editar {path?, arquivo, modo?, antigo?, novo?, ancora?, inicio?, fim?, todos?, esperado?}`: edita um arquivo existente com correspondencia exata ou flexivel.
- `codigo.criar {path?, arquivo, conteudo, sobrescrever?}`: cria ou escreve arquivo.
- `codigo.substituir {path?, antigo, novo, filtro?, confirmado?}`: realiza substituição global de texto no projeto (find and replace). Sem `confirmado` (ou `false`), traz apenas a prévia de alterações.
- `codigo.referencias {path?, simbolo}`: encontra todas as referências de um símbolo no projeto.
- `codigo.patch.preview {path?, diff?, patches?}`: valida patch antes de aplicar.
- `codigo.patch.aplicar {path?, diff?, patches?}`: aplica diff Git ou patches textuais.
- `codigo.scaffold {nome, tipo_projeto?, path?}`: cria projeto simples usando templates locais.
- `codigo.projeto {objetivo, path?, passos?}`: planeja, altera arquivos, reporta progresso por passo, valida com comandos seguros e retorna bloqueio explícito se não conseguir concluir.
- `codigo.comando {path?, comando}`: executa comando de desenvolvimento permitido, sem shell.
- `codigo.terminal {path?, comando, confirmado?}`: executa shell real com classificacao de risco.
- `codigo.confirmar {}`: executa comando pendente apos o usuario autorizar.
- `codigo.cancelar {}`: descarta comando pendente.
- `codigo.git {path?, operacao, arquivo?}`: consulta status, diff, diffStat ou log.
- `codigo.indexar {path?, refresh?}`: gera indice persistente de arquivos e exports.
- `codigo.diagnostico {path?}`: roda checagens detectadas e permitidas.

## Escrita de Codigo

A escrita real usa `integrations.code.allowPatchApply`. Quando ativo, o Ares pode:

- criar arquivos;
- editar arquivos existentes com `codigo.editar`;
- realizar substituições globais com `codigo.substituir`;
- aplicar patches textuais;
- aplicar diffs Git;
- gerar scaffolds;
- usar o executor autonomo para tarefas de varios arquivos.

`codigo.editar` cobre alteracoes pequenas e localizadas. Modos suportados:

- `replace`: troca `antigo` por `novo`;
- `insert_before`: insere `novo` antes de `ancora` ou `antigo`;
- `insert_after`: insere `novo` depois de `ancora` ou `antigo`;
- `line_range`: substitui as linhas `inicio` ate `fim` por `novo`.

A ferramenta tenta match exato, depois match flexivel por linhas aparadas e por espacos normalizados. Se houver mais de uma ocorrencia, ela rejeita a edicao a menos que `todos` esteja ativo; `esperado` permite exigir uma quantidade exata de matches.

`codigo.substituir` permite a substituição global (find and replace) em vários arquivos do projeto. Por segurança, se for chamada com `confirmado: false`, ela apenas simula a operação e retorna um relatório de visualização prévia das mudanças (preview). Se chamada com `confirmado: true`, ela realiza a substituição real, respeitando os caminhos seguros permitidos e com limite máximo de 40 arquivos alterados por vez.

Caminhos sensiveis como `.git`, `.ssh`, `.env` e chaves SSH sao bloqueados para escrita.

O preview de patch continua recomendado antes de aplicar mudancas grandes. O agente deve explicar quais arquivos serao alterados e validar o projeto depois da escrita sempre que houver comando permitido.

## Execução confiável e conclusão honesta

O modo programador não deve finalizar uma tarefa em silêncio. O orquestrador mantém um ledger por turno com ferramentas executadas, arquivos escritos, comandos rodados, validações, autorizações pendentes e bloqueios. Antes de gravar a fala final, `groundCodeSpeech` confere esse ledger: se o Ares disser que alterou, criou, rodou testes ou validou sem evidência real, a fala é substituída por um bloqueio honesto.

Promessas também são tratadas como compromisso operacional. Se o modelo responder "vou alterar", "vou rodar" ou "vou chamar o Prometeu" sem emitir ações `codigo.*`/`subagente.*`, o runtime faz uma rodada corretiva pedindo ações reais ou uma explicação de bloqueio. O modo programador tem limite maior de rodadas encadeadas que conversas comuns; se o limite for atingido com ferramentas pendentes, isso entra nas notas e na fala final em vez de ser descartado.

## Terminal

O terminal nativo tem tres camadas:

- `allowed`: comandos permitidos por allowlist ou prefixos seguros;
- `confirm`: comandos que exigem autorizacao explicita do usuario;
- `blocked`: comandos destrutivos ou de elevacao que nunca rodam.

No Windows, `codigo.terminal` usa PowerShell. Nos demais sistemas, usa Bash. Exemplos bloqueados incluem elevacao de privilegio, formatacao de disco, reinicio da maquina e remocoes recursivas perigosas.

## Uso por Voz

Quando o comando vem do microfone, o Ares cria uma interpretacao auxiliar para termos comuns em codigo:

- "src barra main ponto ts" -> `src/main.ts`;
- "app ponto t s x" -> `app.tsx`;
- "traço" -> `-`;
- "underline" ou "sublinhado" -> `_`;
- "npm rum verify" -> `npm run verify`;
- "git estado" -> `git status`.

### Interação Contínua, Cancelamento e Heartbeats

Durante execuções longas (como builds, testes ou escrita contínua pelo coder autônomo), o microfone de conversação contínua permanece ativo:
- **Interrupção e Cancelamento**: Caso o usuário fale palavras curtas de parada no início da frase, como `"para"`, `"cancela"`, `"aborta"`, `"esquece"`, `"pode parar"` ou `"stop"`, a tarefa atual é abortada imediatamente (enviando SIGTERM/SIGKILL para o processo) e a resposta de voz é silenciada na hora. A palavra de ativação não é exigida para comandos de cancelamento curtos (até 4 palavras). Em mudanças de fase do turno, o transcript falado continua unificado; o que muda é a fila pendente obsoleta, para evitar repetição ou narração antiga por cima do passo atual.
- **Fila de Comandos**: Comandos ditos durante a execução precedidos pela palavra de ativação (ex: "Ares, depois rode os testes") são enfileirados e executados automaticamente na sequência. Falas ou conversas paralelas sem a palavra de ativação e sem verbos de cancelamento são ignoradas por segurança.
- **Batimento Cardíaco (Heartbeats)**: Se um comando de terminal, build, teste, subagente ou coder demorar mais do que 15 segundos, o Ares emitirá avisos de voz breves a cada 30 segundos. Em execução paralela, o heartbeat usa a frente ativa mais recente e retorna para a tarefa remanescente quando outra termina.

Em respostas faladas normais, o Ares nao deve ler codigo, diffs, JSON, `stdout` ou `stderr`. Para ferramentas `codigo.*`, a resposta final e gerada primeiro, sanitizada e enviada ao TTS so depois. O formato ideal da fala e: arquivo principal, acao feita, validacao e proximo passo em uma ou duas frases.

## Sessões Retomáveis (Worklogs)

O Ares arquiva automaticamente o histórico de comandos e ferramentas do projeto ativo em um Diário de Trabalho (`worklog.json`). Quando você retorna a um projeto, o Ares injeta o contexto resumido de forma invisível. 

- O comando `codigo.retomar` lê esse diário mais o status atual do Git e gera um resumo falável de qual era o último passo, escopo, arquivos alterados e pendências de Git, oferecendo continuação ("Continuo do passo 3?").
- O diário arquiva um limite de 10 sessões recentes e não quebra a memória de tokens do modelo (limite de tamanho autogerenciado).
- Durante a inicialização ou "Briefing do Dia", o Ares alertará discretamente se houver trabalho incompleto recente no projeto atual.
- Para gravar, fechar ou dar logout em uma sessão de trabalho, o modelo recomendará comitar de forma interativa.

## Diagnostico

`codigo.diagnostico` examina `package.json` e tenta rodar scripts comuns quando eles estao permitidos:

- typecheck;
- lint;
- test;
- build.

Se um script existir mas nao estiver na allowlist, ele aparece como nao executado. Isso evita que o Ares rode comandos inesperados sem configuracao explicita.

## Configuracao Recomendada

```json
{
  "integrations": {
    "code": {
      "enabled": true,
      "workspaceRoot": "~/Documentos",
      "allowedRoots": ["~"],
      "maxFileKB": 256,
      "maxSearchResults": 40,
      "maxContextChars": 16000,
      "allowedCommands": [
        "npm test",
        "npm run test",
        "npm run typecheck",
        "npm run build",
        "npm run verify",
        "npx tsc --noEmit",
        "git status --short",
        "git diff --stat",
        "git diff"
      ],
      "commandTimeoutMs": 120000,
      "allowPatchApply": true,
      "indexMaxFiles": 600,
      "terminalEnabled": true,
      "terminalAutoApprove": false
    }
  }
}
```

## Exemplos de Uso

- "Analise o projeto em `/home/acer/Documentos/Ares`."
- "Procure onde fica `runCodeTerminal`."
- "Leia `src/main/code.ts` a partir da linha 420."
- "Troque essa funcao por uma versao mais simples em `src/main/code.ts`."
- "Crie um arquivo `docs/NOTAS.md` com o resumo da arquitetura."
- "Faça preview desse patch."
- "Aplique o patch e rode `npm run verify`."
- "Diagnostique este projeto."
- "Crie uma pagina simples chamada Portfolio em `~/Documentos`."

## Boas Praticas do Agente

- Localizar antes de editar.
- Ler arquivos com linhas antes de explicar detalhes.
- Preferir `codigo.editar` para alteracoes pequenas em arquivo existente.
- Preferir patches pequenos e reversiveis.
- Rodar diagnostico ou comando de teste apos mudancas.
- Pedir autorizacao antes de comandos que alterem ambiente, dependencias ou Git.
- Usar `codigo.git` para status e diff em vez de assumir o estado do repositorio.
