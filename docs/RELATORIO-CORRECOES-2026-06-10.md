# Relatorio de correcoes - 2026-06-10

## Resumo

Este pacote corrige travamentos de voz, melhora o uso da Colmeia de subagentes,
unifica os chats das abas Assistente e Escritorio e limpa os dados locais a pedido
do usuario.

## Voz

- Mantida a voz neural atual do Piper como padrao.
- Removido o rebaixamento automatico para Web Speech quando a engine esta em
  `auto` ou `piper`.
- Se o Piper falhar em uma frase, o Ares registra a falha, libera o turno e
  continua por texto, sem trocar para voz inferior.
- Corrigida a falha em que a resposta final de uma pesquisa da Atena aparecia no
  chat, mas nao era enviada para a fila de voz.
- A fala final agora entra como fallback quando uma fase anterior falou, mas a
  fase final nao gerou audio.

## Chats

- A aba Assistente e a aba Escritorio agora usam o mesmo painel de conversa.
- O Escritorio tambem permite ver historico, abrir chats antigos e criar nova
  conversa.
- O chat ativo, historico e controles de envio sao compartilhados entre as duas
  abas.

## Colmeia e subagentes

- Se o Ares prometer acionar Atena, Hefesto ou Temis e o modelo esquecer a acao
  JSON, o runtime converte a promessa em uma acao real de subagente.
- A Atena agora coleta busca web normal, busca focada em recencia e noticias do
  Google News RSS.
- O prompt da Atena foi reforcado para priorizar noticias recentes, datas,
  fontes, divergencias e incertezas.
- O Ares passa contexto compacto para subagentes: contexto direto da acao,
  resumo de conversa e ultimas mensagens relevantes, com limite fixo para evitar
  gasto inutil de tokens.

## Estabilidade

- O turno do chat nao fica mais bloqueado ate a voz terminar; o usuario pode
  iniciar outro pedido e a fala anterior e interrompida.
- O IPC do chat tolera janela fechada ou renderer destruido durante streaming.
- No Linux, foram adicionados switches de fallback grafico para reduzir quedas
  por falha do processo de GPU do Electron.

## Dados locais

- `sessions.json` foi limpo.
- `memory.json` foi recriado contendo apenas: `O usuario se chama Alvaro.`
- `config.json` foi preservado, incluindo as APIs ja configuradas, e
  `ui.userName` foi ajustado para `Alvaro`.

## Validacao

- `npm run typecheck`
- `npm run test:unit`
- `npm run build`
- Smoke test local do Piper gerando WAV com a voz atual `pt_BR-faber-medium`
