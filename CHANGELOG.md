# Changelog

## 0.19.0 - 2026-06-08

- Removeu a delegacao externa do fluxo de programacao.
- Tornou leitura, escrita, patches, scaffold, terminal, diagnostico e coder autonomo o caminho nativo para edicao de codigo.
- Removeu telas, configuracoes, tipos, IPCs, testes e documentacao da integracao legada.
- Ajustou o terminal de programacao para usar PowerShell no Windows e Bash nos demais sistemas.
- Ativou `allowPatchApply` por padrao em novas configuracoes para permitir edicao nativa apos o onboarding.
- Atualizou a documentacao para o fluxo nativo e para o instalador Windows com reset de configuracao.

## 0.18.0 - 2026-06-08

- Primeiro uso passou a exigir chave Groq, estado, cidade e provedor/modelo.
- Modelos DeepSeek foram restringidos a `deepseek-v4-flash` e `deepseek-v4-pro`.
- Voz no Windows recebeu ajustes de naturalidade, tom, velocidade e selecao de voz.
- Instalador Windows passou a resetar `config.json` em upgrades para forcar novo onboarding.
- Workflow de instaladores gerou artefatos para Windows e Linux.

## 0.17.x e anteriores

- Base Electron, React e TypeScript.
- Tarefas, agenda, listas, notas, memoria, lembretes, briefing, clima, noticias e busca web.
- Controle local de sistema, atalhos, bandeja, overlay e backup de dados.
- Modo programador com workspace, busca, leitura, comandos, patches, scaffold, indice e diagnostico.
