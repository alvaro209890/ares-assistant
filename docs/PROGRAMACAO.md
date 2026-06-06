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
      "maxContextChars": 16000
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

## Segurança

- As ferramentas locais não escrevem arquivos.
- Caminhos fora de `allowedRoots` são bloqueados.
- Arquivos binários ou acima de `maxFileKB` são recusados.
- O contexto enviado ao Hermes é limitado por `maxContextChars`.
- Alterações reais continuam sob responsabilidade do Hermes Code ou de uma etapa
  explícita fora dessas ferramentas locais.

## Exemplos de Voz

- "Ares, analise o projeto em `/home/acer/Documentos/Ares`."
- "Procure onde fica `hermesCodeTask`."
- "Leia `src/main/agent.ts` a partir da linha 80."
- "Peça ao Hermes Code para revisar `src/main/code.ts` e sugerir testes."
- "Peça ao Hermes Code para refatorar o fluxo de diagnóstico."

## Testes

```bash
npm test
```

A suíte `tests/code.test.ts` valida:

- resumo de workspace;
- busca com filtro;
- leitura com linhas;
- bloqueio de path fora da raiz permitida;
- delegação estruturada ao Hermes Code.
