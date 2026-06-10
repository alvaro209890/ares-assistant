# Controle do Computador

O Ares pode **agir no computador** por voz, estilo JARVIS: abrir aplicativos e
sites, ajustar o volume, bloquear a tela, tirar capturas e escrever na área de
transferência. São ações **seguras e instantâneas** — diferente do terminal
(`codigo.terminal`), elas **não pedem autorização** e **não usam shell**: rodam
binários conhecidos do sistema, sem interpretação de comando.

## Ferramentas do Agente

- `sistema.abrir {alvo}` — abre app, site ou arquivo.
  - apps por apelido: `firefox`, `chrome`, `vscode`, `calculadora`, `arquivos`,
    `terminal`, `navegador`, `editor`…
  - **Integração com Menu Iniciar (Windows)**: No Windows, o Ares varre todos os atalhos (`.lnk` / `.url`) do Menu Iniciar e permite abrir qualquer aplicativo instalado via busca difusa (fuzzy match) inteligente. O casamento é tolerante a acentos, palavras parciais, maiúsculas e pequenos erros de transcrição de voz (ex.: "abre o Whatsapp", "abra o QGIS", "abrir OBS").
  - sites: `youtube.com`, `https://github.com` (domínio sem `http` vira `https://`);
  - arquivos/pastas: `~/Documentos`, `/caminho/arquivo.pdf`.
- `sistema.volume {acao, nivel?}` — `acao`: `set`/`up`/`down`/`mute`/`unmute`/`toggle`;
  `nivel` (0–100) para `set`. O Ares entende fala natural ("aumenta", "diminui",
  "muda pro mudo", "volume em 30").
- `sistema.midia {acao}` — controla a música/vídeo: `playpause`/`play`/`pause`/
  `next`/`previous`/`stop`. Entende "pausa", "próxima", "toca", "para".
- `sistema.brilho {acao, nivel?}` — `set`/`up`/`down` do brilho da tela.
  "clareia", "escurece", "brilho em 50".
- `sistema.bloquear {}` — bloqueia a tela.
- `sistema.captura {}` — captura a tela inteira e salva um PNG.
- `area.escrever {texto}` — copia um texto para a área de transferência
  (complementa `area.ler`).
- `desfazer {}` — desfaz a **última alteração de dados** (tarefa, lista, nota,
  lembrete, evento ou memória). "desfaz", "cancela isso", "volta atrás".

## Exemplos de voz

- "Abra o Firefox." · "Abra o YouTube." · "Abra a calculadora."
- "Abra a pasta Documentos." · "Abra o VS Code."
- "Aumenta o volume." · "Diminui um pouco." · "Volume em 25." · "Muda pro mudo."
- "Pausa a música." · "Próxima." · "Volta a tocar."
- "Clareia a tela." · "Brilho em 40." · "Escurece um pouco."
- "Bloqueia a tela." / "Trava o PC."
- "Tira um print da tela."
- "Copia esse texto pra área de transferência."
- "Desfaz." / "Cancela isso." / "Volta atrás." (reverte a última mudança em dados)

## Backends por ação (Linux)

O Ares detecta a ferramenta disponível e usa a primeira que existir:

| Ação | Ferramentas (em ordem) |
| --- | --- |
| abrir | apelido → binário do app; senão `xdg-open` |
| volume | `wpctl` (PipeWire) → `pactl` (PulseAudio) → `amixer` (ALSA) |
| mídia | `playerctl` → MPRIS via `dbus-send` (usa o primeiro player ativo) |
| brilho | `xrandr --brightness` (brilho de software, X11) — piso de 10% |
| bloquear | `loginctl lock-session` → `cinnamon-screensaver-command` → `xdg-screensaver` → `gnome-screensaver-command` |
| captura | `gnome-screenshot` → `grim` → `spectacle` → `scrot` |
| área de transferência | API nativa do Electron |

Se nenhuma ferramenta da categoria existir (ou, na mídia, não houver player ativo),
o Ares responde que não conseguiu — sem quebrar nada.

## Desfazer

`desfazer` reverte a **última alteração de dados**. Antes de cada turno que muda
dados, o Ares tira um snapshot dos arquivos JSON do usuário
(`tasks/calendar/lists/notes/reminders/memory.json` — **não** inclui conversas nem
config). "Desfaz" restaura o último snapshot — um undo universal, independente da
ação que mudou o estado. A pilha guarda as últimas 15 alterações e vale dentro da
execução atual do app (`src/main/history.ts`).

## Configuração

```json
{
  "integrations": {
    "control": {
      "enabled": true,
      "screenshotDir": "/home/acer/Pictures"
    }
  }
}
```

- `enabled`: liga/desliga todo o controle do computador (também em
  Configurações > Controle do Computador, e o estado aparece na tela Sistema).
- `screenshotDir`: pasta onde as capturas são salvas (criada se não existir). Os
  arquivos seguem o padrão `ares-AAAA-MM-DDThh-mm-ss.png`.

## Segurança

- Ações sem shell: cada uma roda um binário específico com argumentos fixos
  (sem `;`, `|`, `&`, etc.).
- `sistema.abrir` bloqueia esquemas perigosos (só permite `http(s)`, `file`,
  `mailto`, `ftp`); apelidos resolvem para apps instalados; caminhos precisam
  existir.
- Volume é limitado a 0–100%.
- Para desligar tudo, basta `control.enabled = false`.

## Testes

`tests/control.test.ts` valida (funções puras, sem tocar no sistema):

- `resolveOpenTarget`: URL, domínio sem esquema, apelido de app, app ausente,
  esquema bloqueado, binário no PATH e alvo vazio;
- `audioBackend`/`mediaBackend`: precedência de backends;
- `buildVolume`: comandos por backend e clamp de nível;
- `buildMedia`: verbos do `playerctl` e métodos MPRIS via `dbus-send`;
- `buildBrightness`: conversão 0-100 → fração, clamp `[0.1, 1]`, passos de up/down.

`tests/history.test.ts` valida o desfazer: restauração de arquivo, remoção de
arquivo que não existia no snapshot, pilha LIFO e `captureSnapshot`/`applySnapshot`.
