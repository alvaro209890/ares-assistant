# Programacao Nativa no Ares

O modo programador do Ares e nativo. Ele trabalha diretamente no workspace permitido, sem delegar edicao, revisao, refatoracao ou teste para outro agente.

## Ferramentas

- `codigo.workspace {path?}`: resume projeto, stack, scripts, linguagens e estado Git.
- `codigo.buscar {path?, consulta, filtro?}`: busca texto ou simbolos.
- `codigo.ler {path?, arquivo, inicio?, linhas?}`: le trechos com numeros de linha.
- `codigo.criar {path?, arquivo, conteudo, sobrescrever?}`: cria ou escreve arquivo.
- `codigo.patch.preview {path?, diff?, patches?}`: valida patch antes de aplicar.
- `codigo.patch.aplicar {path?, diff?, patches?}`: aplica diff Git ou patches textuais.
- `codigo.scaffold {nome, tipo_projeto?, path?}`: cria projeto simples usando templates locais.
- `codigo.projeto {objetivo, path?, passos?}`: planeja, altera arquivos e valida uma tarefa maior.
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
- aplicar patches textuais;
- aplicar diffs Git;
- gerar scaffolds;
- usar o executor autonomo para tarefas de varios arquivos.

O preview de patch continua recomendado antes de aplicar mudancas grandes. O agente deve explicar quais arquivos serao alterados e validar o projeto depois da escrita sempre que houver comando permitido.

## Terminal

O terminal nativo tem tres camadas:

- `allowed`: comandos permitidos por allowlist ou prefixos seguros;
- `confirm`: comandos que exigem autorizacao explicita do usuario;
- `blocked`: comandos destrutivos ou de elevacao que nunca rodam.

No Windows, `codigo.terminal` usa PowerShell. Nos demais sistemas, usa Bash. Exemplos bloqueados incluem elevacao de privilegio, formatacao de disco, reinicio da maquina e remocoes recursivas perigosas.

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
- "Crie um arquivo `docs/NOTAS.md` com o resumo da arquitetura."
- "Faça preview desse patch."
- "Aplique o patch e rode `npm run verify`."
- "Diagnostique este projeto."
- "Crie uma pagina simples chamada Portfolio em `~/Documentos`."

## Boas Praticas do Agente

- Localizar antes de editar.
- Ler arquivos com linhas antes de explicar detalhes.
- Preferir patches pequenos e reversiveis.
- Rodar diagnostico ou comando de teste apos mudancas.
- Pedir autorizacao antes de comandos que alterem ambiente, dependencias ou Git.
- Usar `codigo.git` para status e diff em vez de assumir o estado do repositorio.
