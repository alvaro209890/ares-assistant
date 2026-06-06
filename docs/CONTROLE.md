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
  - sites: `youtube.com`, `https://github.com` (domínio sem `http` vira `https://`);
  - arquivos/pastas: `~/Documentos`, `/caminho/arquivo.pdf`.
- `sistema.volume {acao, nivel?}` — `acao`: `set`/`up`/`down`/`mute`/`unmute`/`toggle`;
  `nivel` (0–100) para `set`. O Ares entende fala natural ("aumenta", "diminui",
  "muda pro mudo", "volume em 30").
- `sistema.bloquear {}` — bloqueia a tela.
- `sistema.captura {}` — captura a tela inteira e salva um PNG.
- `area.escrever {texto}` — copia um texto para a área de transferência
  (complementa `area.ler`).

## Exemplos de voz

- "Abra o Firefox." · "Abra o YouTube." · "Abra a calculadora."
- "Abra a pasta Documentos." · "Abra o VS Code."
- "Aumenta o volume." · "Diminui um pouco." · "Volume em 25." · "Muda pro mudo."
- "Bloqueia a tela." / "Trava o PC."
- "Tira um print da tela."
- "Copia esse texto pra área de transferência."

## Backends por ação (Linux)

O Ares detecta a ferramenta disponível e usa a primeira que existir:

| Ação | Ferramentas (em ordem) |
| --- | --- |
| abrir | apelido → binário do app; senão `xdg-open` |
| volume | `wpctl` (PipeWire) → `pactl` (PulseAudio) → `amixer` (ALSA) |
| bloquear | `loginctl lock-session` → `cinnamon-screensaver-command` → `xdg-screensaver` → `gnome-screensaver-command` |
| captura | `gnome-screenshot` → `grim` → `spectacle` → `scrot` |
| área de transferência | API nativa do Electron |

Se nenhuma ferramenta da categoria existir, o Ares responde que não conseguiu (não
quebra nada).

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
- `audioBackend`: precedência `wpctl > pactl > amixer`;
- `buildVolume`: comandos de `set`/`up`/`down`/`mute`/`toggle` por backend e clamp
  de nível.
