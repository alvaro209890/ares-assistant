# Roadmap

## Estado Atual

Ares e um assistente desktop local com voz, tarefas, agenda, memoria, lembretes, clima, noticias, controle de computador e modo programador nativo.

Concluido:

- Onboarding obrigatorio para chave Groq, estado, cidade e provedor/modelo.
- Modelos DeepSeek limitados a `deepseek-v4-flash` e `deepseek-v4-pro`.
- Voz mais natural no Windows via Web Speech do Chromium.
- Reset de configuracao no instalador Windows para upgrades.
- Instaladores Linux e Windows via GitHub Actions.
- Modo programador nativo com busca, leitura, escrita, patches, scaffold, terminal e diagnostico.

## Proximos Passos

1. Melhorar a experiencia visual de diff e preview de patches.
2. Adicionar historico de alteracoes de codigo dentro da UI.
3. Criar confirmacao visual para comandos `confirm` do terminal.
4. Expandir templates de `codigo.scaffold`.
5. Melhorar detecao de scripts em projetos Python, Go, Rust e .NET.
6. Adicionar testes end-to-end da primeira execucao no Windows.
7. Melhorar descoberta de vozes do sistema no Windows.

## Qualidade

- Manter `npm run verify` verde antes de publicar.
- Manter o instalador Windows testado por artefato de CI.
- Evitar dependencias externas para edicao de codigo.
- Preservar travas de seguranca no terminal.
- Documentar qualquer nova ferramenta do agente no README e em `docs/PROGRAMACAO.md`.
