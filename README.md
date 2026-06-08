# Ares

Ares e um assistente desktop em Electron, React e TypeScript, feito para uso local em Linux e Windows. Ele combina conversa por voz, tarefas, agenda, lembretes, memoria, clima, noticias, controle basico do computador e um modo programador nativo para ler, editar, testar e diagnosticar projetos no proprio PC.

## Destaques

- **Primeira execucao obrigatoria**: o onboarding pede chave Groq, estado, cidade e provedor/modelo antes de liberar o uso normal.
- **Voz neural (Linux e Windows)**: usa o Piper local — voz masculina pt-BR grave e humana, estilo JARVIS. O binario e baixado em background no primeiro uso; ate ficar pronto (e no macOS) usa a Web Speech do Chromium como fallback, priorizando vozes Natural/Neural/Online.
- **Responde por voz tambem ao texto**: mensagens digitadas no chat sao faladas quando o TTS esta ligado, nao so os comandos de microfone.
- **Modelos DeepSeek**: somente `deepseek-v4-flash` e `deepseek-v4-pro` ficam disponiveis.
- **Modo Programador nativo**: busca codigo, le arquivos com linhas, cria arquivos, aplica patches, gera scaffold, roda diagnostico e usa terminal local com autorizacao.
- **Edicao por voz no codigo**: entende caminhos ditados como "src barra main ponto ts" e evita ler codigo, diffs ou logs em voz alta.
- **Atualizar por cima preserva os dados**: instalar uma versao nova sobre a antiga (Windows) mantem config, chaves, cidade, localizacao, tarefas, memoria e sessoes.
- **Dados locais**: tarefas, memoria, agenda, listas, notas e lembretes ficam no `userData` do Electron.

## Instalar

### Windows

O instalador e gerado pelo workflow **Build Installers** no GitHub Actions e tambem pode ser baixado dos artefatos da execucao. O arquivo local baixado fica em:

```text
dist/windows-installer/ARES-<versao>-Setup-x64.exe
```

Ao instalar em um PC que ja tinha Ares, o instalador **atualiza no mesmo diretorio e preserva todos os dados** em `%APPDATA%\ares` (config, chaves, cidade, localizacao, tarefas, memoria, sessoes e a voz neural ja baixada). Campos novos de configuracao entram automaticamente pelo merge com os padroes — nao e preciso refazer o onboarding.

### Linux

Use os artefatos `.deb` ou `.AppImage` gerados no mesmo workflow, ou gere localmente:

```bash
npm run dist:linux
```

## Desenvolvimento

Requisitos:

- Node.js 20.19+ ou 22.12+
- npm
- Git

Comandos principais:

```bash
npm install
npm run dev
npm run typecheck
npm run test:unit
npm run verify
npm run dist:win
npm run dist:linux
```

## Configuracao

A configuracao real fica no diretorio `userData` do Electron:

- Windows: `%APPDATA%/ares/config.json`
- Linux: `~/.config/ares/config.json`

Campos importantes:

| Campo | Uso |
| --- | --- |
| `grog.apiKey` | chave Groq obrigatoria para transcricao de voz |
| `nineRouter.baseUrl` | endpoint OpenAI-compatible do cerebro |
| `nineRouter.model` | modelo de texto selecionado |
| `tts.engine` | `auto` (Piper no Linux/Windows, Web Speech de fallback), `piper` ou `web` |
| `tts.piperVoice` | voz neural do Piper (padrao `pt_BR-faber-medium`) |
| `tts.webVoiceURI` | voz do sistema usada no fallback Web Speech |
| `integrations.location.city` | cidade definida no onboarding |
| `integrations.location.region` | UF definida no onboarding |
| `integrations.code.workspaceRoot` | workspace padrao do modo programador |
| `integrations.code.allowedRoots` | raizes em que o Ares pode ler/escrever codigo |
| `integrations.code.allowPatchApply` | permite escrita, scaffold e aplicacao de patches |
| `integrations.code.terminalEnabled` | habilita terminal local com travas |
| `integrations.code.terminalAutoApprove` | roda comandos fora da allowlist sem pedir confirmacao, recomendado deixar `false` |

Veja `config.example.json` para um template completo.

## Modo Programador

O Ares nao depende de servico externo para editar codigo. As ferramentas nativas sao:

- `codigo.workspace`: resume stack, scripts, linguagens, arquivos ignorados e estado Git.
- `codigo.buscar`: busca texto ou simbolos em arquivos permitidos.
- `codigo.ler`: le trechos com numeros de linha.
- `codigo.criar`: cria ou sobrescreve arquivos quando permitido.
- `codigo.patch.preview`: valida e resume patches antes de aplicar.
- `codigo.patch.aplicar`: aplica diff Git ou operacoes textuais.
- `codigo.scaffold`: cria projetos simples a partir de templates locais.
- `codigo.projeto`: planeja e executa tarefas maiores com escrita e validacao.
- `codigo.comando`: roda comandos de desenvolvimento permitidos sem shell.
- `codigo.terminal`: usa shell real com classificacao `allowed`, `confirm` ou `blocked`.
- `codigo.diagnostico`: roda typecheck, lint, teste e build quando houver scripts permitidos.
- `codigo.git`: consulta status, diff e log sem alterar o repositorio.

No Windows, o terminal nativo usa PowerShell. No Linux e macOS, usa Bash. Comandos destrutivos ou de elevacao continuam bloqueados mesmo com confirmacao.

### Voz no Modo Programador

Quando a entrada vem do microfone, o agente adiciona uma interpretacao auxiliar para termos comuns de desenvolvimento: "barra" vira `/`, "ponto ts" vira `.ts`, "traço" vira `-`, "underline" vira `_`, "npm rum" vira `npm run` e "git estado" vira `git status`. A resposta final de ferramentas `codigo.*` nao e transmitida em streaming bruto; ela e gerada, filtrada e so entao falada para evitar que o Ares leia codigo, JSON, diffs ou logs longos. A fala deve ficar em ate duas frases com o arquivo principal, o que mudou, se a validacao passou e qual autorizacao falta.

## Arquitetura

- `src/main/agent.ts`: prompt do agente, roteamento de acoes e execucao das ferramentas.
- `src/main/code.ts`: motor nativo de programacao, patches, terminal, scaffold e diagnostico.
- `src/main/coder.ts`: executor autonomo para tarefas de codigo em varias etapas.
- `src/main/voiceCode.ts`: interpretacao e sanitizacao de respostas de programacao por voz.
- `src/main/piper.ts`: voz neural Piper multiplataforma (download do binario + sintese em Linux e Windows).
- `src/main/config.ts`: defaults e merge nao-destrutivo da configuracao (preserva dados em upgrades).
- `src/renderer`: interface React.
- `src/preload`: API IPC tipada exposta ao renderer.
- `build/installer.nsh`: customizacoes NSIS (upgrade no mesmo diretorio, preservando os dados do usuario).
- `.github/workflows/build-installers.yml`: gera instaladores Linux e Windows.

## Verificacao

Antes de publicar:

```bash
npm run verify
```

O workflow de instaladores roda em push para `main` e publica artefatos para Windows e Linux.
