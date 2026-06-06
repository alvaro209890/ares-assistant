# Ares Bridge — ponte local (Hermes/Code) movida a 9Router

Servidor local, sem dependências (`node:http` + `fetch`), que dá ao Ares uma ponte
funcional **neste PC** usando o **mesmo cérebro do Ares**: 9Router `cx/gpt-5.5`.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/health` | status (serviço, modelo, 9Router) |
| `POST` | `/message` | comando geral respondido pelo 9Router → `{ reply }` |
| `POST` | `/code` | tarefa de programação → `{ summary, patches, tests, risks, commands, needsConfirmation }` |

## Rodar

```bash
npm run bridge        # http://127.0.0.1:18789 (Node >=18)
```

Variáveis (todas opcionais): `ARES_BRIDGE_PORT` (18789), `ARES_BRIDGE_HOST`
(127.0.0.1), `NINEROUTER_BASE_URL` (http://localhost:20128/v1), `NINEROUTER_MODEL`
(cx/gpt-5.5), `NINEROUTER_API_KEY`, `ARES_BRIDGE_TOKEN`, `ARES_BRIDGE_TIMEOUT_MS`.

## Sempre ligado (systemd --user)

```bash
install -D -m 644 bridge/ares-bridge.service ~/.config/systemd/user/ares-bridge.service
systemctl --user daemon-reload
systemctl --user enable --now ares-bridge.service
```

## ⚠️ Porta 18789 x Hermes Desktop

O Hermes Desktop completo (WhatsApp/Trello/Obsidian/office) também usa a **:18789** e
não divide a porta. Rode **só um de cada vez** ali. Para usar o Hermes Desktop, pare a
ponte: `systemctl --user stop ares-bridge.service`. Para os dois juntos, suba a ponte
em outra porta (`ARES_BRIDGE_PORT=18790`) e aponte o Ares para ela.

Detalhes completos em [`../docs/PONTE_HERMES.md`](../docs/PONTE_HERMES.md).
