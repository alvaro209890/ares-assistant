# Programação no Ares

O Modo Programador dá ao Ares contexto real de projetos locais e uma ponte dedicada
para o Hermes Code. Ares faz leitura e busca local em modo somente leitura; tarefas
de edição, refatoração e análise profunda são enviadas ao Hermes.

## Ferramentas do Agente

- `codigo.workspace {path?}`: resume workspace, stack, scripts, git, linguagens,
  arquivos relevantes e diretórios ignorados.
- `codigo.buscar {path?, consulta, filtro?}`: busca texto ou símbolo no código.
  `filtro` aceita valores simples como `*.ts`, `src/` ou `components`.
- `codigo.ler {path?, arquivo, inicio?, linhas?}`: lê trecho de arquivo com números
  de linha.
- `codigo.hermes {tarefa, modo?, path?, arquivos?}`: delega ao Hermes Code com
  workspace e snippets.
- `codigo.comando {path?, comando}`: executa comando de desenvolvimento presente
  na allowlist, sem shell.
- `codigo.terminal {path?, comando, confirmado?}`: terminal completo via shell
  (`bash -lc`), com pipes, `&&` e redirecionamento. Comandos seguros/allowlist
  rodam direto; os demais exigem autorização; catastróficos são bloqueados.
- `codigo.confirmar {}`: executa a ação que ficou pendente de autorização.
- `codigo.cancelar {}`: descarta a ação pendente.
- `codigo.git {path?, operacao, arquivo?}`: consulta `status`, `diff`, `diffStat`
  ou `log`.
- `codigo.indexar {path?, refresh?}`: gera/lê índice persistente do projeto.
- `codigo.patch.preview {path?, diff?, patches?}`: valida patch antes de aplicar.
- `codigo.patch.aplicar {path?, diff?, patches?}`: aplica patch quando a config
  permitir.

Modos sugeridos para `codigo.hermes`:

- `review`: revisão de código.
- `edit`: edição/refatoração.
- `debug`: investigação de bug.
- `tests`: criação ou ajuste de testes.
- `refactor`: reorganização técnica.
- `explain`: explicação aprofundada.

## Configuração

```json
{
  "integrations": {
    "hermes": {
      "codePath": "/code"
    },
    "code": {
      "enabled": true,
      "workspaceRoot": "/home/acer/Documentos",
      "allowedRoots": ["/home/acer"],
      "maxFileKB": 256,
      "maxSearchResults": 40,
      "maxContextChars": 16000,
      "allowedCommands": ["npm test", "npm run typecheck", "npm run build"],
      "commandTimeoutMs": 120000,
      "allowPatchApply": false,
      "indexMaxFiles": 600,
      "terminalEnabled": true,
      "terminalAutoApprove": false,
      "terminalSafe": ["ls", "cat", "grep", "git status", "git diff", "node --version"]
    }
  }
}
```

Campos:

- `workspaceRoot`: workspace usado quando o usuário não informa path.
- `allowedRoots`: barreira de segurança para leitura/busca local.
- `maxFileKB`: tamanho máximo de arquivo lido.
- `maxSearchResults`: limite por busca.
- `maxContextChars`: limite aproximado do pacote enviado ao Hermes Code.
- `allowedCommands`: lista exata de comandos que podem ser executados.
- `commandTimeoutMs`: timeout de comandos.
- `allowPatchApply`: precisa estar `true` para aplicar patches localmente.
- `indexMaxFiles`: limite de arquivos no índice persistente.
- `terminalEnabled`: liga o terminal completo (`codigo.terminal`).
- `terminalAutoApprove`: roda comandos `confirm` sem pedir autorização.
- `terminalSafe`: prefixos de comando que rodam sem autorização.
- `hermes.codePath`: rota dedicada do Hermes para tarefas de programação.

## Contrato Hermes Code

Por padrão:

```http
POST {baseUrl}{codePath}
Content-Type: application/json
Authorization: Bearer <apiKey opcional>
```

Payload:

```json
{
  "task": "corrija o bug no roteamento",
  "mode": "debug",
  "workspace": {
    "root": "/home/acer/Documentos/Ares",
    "files": ["src/main/agent.ts"]
  },
  "files": [
    {
      "file": "src/main/agent.ts",
      "startLine": 1,
      "endLine": 120,
      "content": "1: import ..."
    }
  ],
  "extra": {},
  "source": "ares",
  "client": "ares-desktop",
  "capability": "code",
  "sessionId": "id-da-conversa"
}
```

Se o Hermes responder `404` ou `405` na rota `codePath`, o Ares faz fallback para
`messagePath` com um texto iniciado por `[ARES_CODE_TASK]`.

Resposta estruturada recomendada:

```json
{
  "summary": "corrige o roteamento de ferramentas de código",
  "patches": [{ "file": "src/main/agent.ts", "diff": "diff --git ..." }],
  "tests": ["npm test"],
  "risks": ["baixo risco; altera apenas prompt e roteamento"],
  "commands": ["npm test"],
  "needsConfirmation": true
}
```

O Ares preserva esse objeto em `structured`, faz preview dos patches com
`codigo.patch.preview` e só aplica com `codigo.patch.aplicar` quando o usuário
confirmar e `allowPatchApply` estiver ativo.

## Patches

Formatos aceitos:

```json
{ "diff": "diff --git a/src/a.ts b/src/a.ts\n..." }
```

ou:

```json
{
  "patches": [
    { "file": "src/a.ts", "find": "antes", "replace": "depois" }
  ]
}
```

Para diffs, o Ares roda `git apply --check` no preview. Para patches textuais, ele
confere se o trecho existe antes de aplicar.

## Comandos e Git

`codigo.comando` não usa shell e rejeita caracteres como `;`, `&`, `|`, `<`, `>` e
`$`. O comando precisa bater com a allowlist.

`codigo.git` aceita apenas:

- `status`;
- `diff`;
- `diffStat`;
- `log`.

## Terminal com autorização

`codigo.terminal` é o terminal completo do Ares: roda via shell real (`bash -lc`),
então aceita pipes, `&&`, `||` e redirecionamento — um terminal de verdade. Para
manter a segurança, cada comando passa por `classifyCommand`, que o coloca em uma
de três camadas:

- **`allowed`** — está na allowlist (`allowedCommands`) ou começa com um prefixo
  seguro (`terminalSafe`, em geral comandos de leitura/inspeção). Roda direto.
- **`confirm`** — qualquer outro comando (instalar dependência, criar/editar
  arquivo, `git add/commit/push`, scripts próprios). Exige autorização explícita.
- **`blocked`** — padrões catastróficos ou de elevação de privilégio. **Nunca**
  rodam, nem com autorização: `sudo`/`su`/`doas`, `rm -rf` de raiz/HOME/`*`,
  `mkfs`, `dd of=/dev/...`, escrita em disco, `shutdown`/`reboot`, fork bomb,
  `chmod -R 777 /`, `curl ... | sh`.

### Fluxo de autorização por voz

1. O Ares chama `codigo.terminal` **sem** `confirmado`.
2. Se o comando for `confirm`, a ferramenta devolve `requiresApproval: true` sem
   executar, e guarda o comando exato como pendência da sessão
   (`src/main/pending.ts`).
3. O Ares diz em voz natural o que será executado e por quê, e pede o "sim"
   ("Senhor, isso vai rodar `npm install left-pad`. Autoriza?").
4. Ao autorizar, o Ares chama `codigo.confirmar`, que executa **exatamente** o
   comando pendente. Ao recusar, chama `codigo.cancelar`.

Com `terminalAutoApprove: true` (avançado), a camada `confirm` roda sem perguntar
— a camada `blocked` continua bloqueada. A pendência expira em 10 minutos.

Campos relacionados em `integrations.code`:

- `terminalEnabled`: liga/desliga o terminal completo.
- `terminalAutoApprove`: roda comandos `confirm` sem pedir (use com cautela).
- `terminalSafe`: prefixos de comando que rodam sem autorização.

## Índice Persistente

`codigo.indexar` grava o índice em:

```text
~/.config/ares/code-indexes/
```

O índice inclui arquivos, linguagem, bytes, linhas, exports, scripts e status Git.

## Segurança

- As ferramentas de leitura/busca não escrevem arquivos.
- `codigo.comando` roda **sem shell** e só aceita comandos da allowlist.
- `codigo.terminal` roda **com shell**, mas em três camadas: comandos seguros/da
  allowlist rodam direto, os demais exigem autorização explícita do usuário e os
  catastróficos são bloqueados sempre (inclusive `sudo`).
- Exceção controlada de escrita: `codigo.patch.aplicar` só escreve quando
  `allowPatchApply=true` e o patch passou no preview.
- Caminhos fora de `allowedRoots` são bloqueados (leitura, busca e workspace).
- Arquivos binários ou acima de `maxFileKB` são recusados.
- O contexto enviado ao Hermes é limitado por `maxContextChars`.

## Exemplos de Voz

- "Ares, analise o projeto em `/home/acer/Documentos/Ares`."
- "Procure onde fica `hermesCodeTask`."
- "Leia `src/main/agent.ts` a partir da linha 80."
- "Peça ao Hermes Code para revisar `src/main/code.ts` e sugerir testes."
- "Peça ao Hermes Code para refatorar o fluxo de diagnóstico."
- "Rode `npm test`."
- "Instale a dependência `dayjs`." (o Ares pede autorização antes de rodar)
- "Crie a pasta `src/utils` e um arquivo index.ts." (pede autorização)
- "Faça commit com a mensagem 'ajusta terminal' e dê push." (pede autorização)
- "Pode rodar." / "Autorizo." (confirma o comando pendente)
- "Deixa pra lá." (cancela o comando pendente)
- "Mostre o diff atual."
- "Faça preview deste patch antes de aplicar."

## Testes

```bash
npm test
```

A suíte `tests/code.test.ts` valida:

- resumo de workspace;
- busca com filtro;
- leitura com linhas;
- bloqueio de path fora da raiz permitida;
- delegação estruturada ao Hermes Code;
- comandos allowlistados;
- Git local;
- índice persistente;
- preview/aplicação de patch textual;
- classificação do terminal (allowed/confirm/blocked);
- terminal pedindo autorização e rodando após aprovação;
- bloqueio de comandos catastróficos mesmo aprovados;
- desligamento do terminal e store de pendências por sessão.
