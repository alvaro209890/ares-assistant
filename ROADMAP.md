# Roadmap — Ares para o dia a dia

Funcionalidades pensadas para deixar o Ares útil e fácil para **pessoas comuns** (sem
conhecimento técnico), com o motivo de cada uma.

> **Status (atualização atual):** quase todo o roadmap das Prioridades 1–4 já foi
> **implementado** ✅ (onboarding, ajuda com exemplos, listas, notas, lembretes/timers,
> contas/conversões, acessibilidade, atalho global + bandeja + autostart, backup,
> indicador de microfone, briefing automático, rascunho via nota). O que segue como
> próximo grande passo é a **ponte com o Hermes** (ver no fim).
>
> **Versão 0.2 (entregue):** ✅ **busca global / paleta de comandos (`Ctrl+K`)**, ✅
> **barge-in** (interromper a fala por voz ou com `Esc`), ✅ **conversão de unidades
> local** (`converter.unidade`), ✅ **leitura/resumo de páginas web** (`pagina.ler`) e
> ✅ microfone com cancelamento de eco. Detalhes em [`CHANGELOG.md`](CHANGELOG.md).

Legenda de esforço: 🟢 baixo · 🟡 médio · 🔴 alto. ✅ = já implementado.

---

## Prioridade 1 — Tirar o atrito de começar a usar

Hoje o app abre direto no painel HUD. Quem não é técnico precisa de ajuda para dar o
primeiro passo. Esta é a área de maior impacto para adoção.

### 1.1 Assistente de primeiros passos (onboarding) 🟡 ✅
Na primeira abertura: perguntar o nome, detectar a localização, testar a voz e o microfone
e um mini‑tutorial “fale comigo”.
- **Por quê:** transforma a primeira impressão; sem isso, muita gente desiste na tela inicial.
- **Base atual:** config, localização e teste de voz já existem; falta o passo a passo guiado.

### 1.2 Ajuda “O que você sabe fazer?” 🟢 ✅
Um botão (e o comando de voz) que mostra **exemplos clicáveis**: “crie uma tarefa”,
“vai chover hoje?”, “me lembra do remédio às 8h”, “faça meu briefing”.
- **Por quê:** descoberta. As pessoas não sabem o que pedir; exemplos prontos ensinam usando.
- **Base atual:** o agente já entende esses comandos; falta a vitrine de exemplos.

### 1.3 Cérebro sem complicação 🟡 ✅
Além do 9 Router local, oferecer um caminho “cole a chave e funciona” (provedor hospedado)
com teste de conexão no onboarding e mensagem clara quando o cérebro está offline.
- **Por quê:** exigir rodar um servidor local é a maior barreira para o público geral.
- **Base atual:** a configuração do endpoint já existe e a tela Sistema já testa o 9 Router.

---

## Prioridade 2 — Valor prático no dia a dia

Funções que as pessoas usam o tempo todo, com o mínimo de fricção.

### 2.1 Listas simples (compras, afazeres) 🟢 ✅
Uma lista separada do Kanban: “adiciona leite na lista de compras”, marcar item com um toque.
- **Por quê:** o Kanban é ótimo, mas “técnico” demais para uma lista de mercado.
- **Base atual:** persistência local e ações por voz já existem (reaproveita o padrão de dados).

### 2.2 Lembretes de remédio e rotina por voz 🟡 ✅
“me lembra de tomar o remédio todo dia às 8h”, com repetição e som; confirmação de “tomei”.
- **Por quê:** utilidade altíssima, em especial para famílias e pessoas mais velhas.
- **Base atual:** lembretes, recorrência e notificações já existem; falta o atalho “saúde/rotina”.

### 2.3 Timer, cronômetro e despertador por voz 🟢 ✅
“põe um timer de 10 minutos”, “me acorda às 6h”, com aviso sonoro.
- **Por quê:** necessidade diária (cozinha, soneca, foco). Simples e muito usado.

### 2.4 Contas rápidas e conversões 🟢 ✅
“quanto é 30% de 250?”, conversões de medida e **cotação de moeda**.
- **Por quê:** tira dúvidas do dia sem abrir calculadora ou navegador.
- **Base atual:** seria uma nova ferramenta de consulta no agente (como clima/notícias).

### 2.5 Anotações e diário rápido 🟢 ✅
“anota que…”, uma tela de notas rápidas; opção de “diário” por voz no fim do dia.
- **Por quê:** capturar ideias no momento, sem fricção.

---

## Prioridade 3 — Conforto, acessibilidade e confiança

### 3.1 Acessibilidade e “modo simples” 🟡 ✅
Tamanho de fonte ajustável, alto contraste e uma visão reduzida (menos HUD, textos maiores).
- **Por quê:** inclui pessoas mais velhas ou com baixa visão e diminui a “intimidação” da
  interface futurista.

### 3.2 Atalho global + ícone na bandeja + iniciar com o sistema 🟡 ✅
Chamar o Ares de qualquer lugar com uma tecla; ícone na barra do sistema; abrir junto com o
computador.
- **Por quê:** presença constante e zero fricção para acionar. Combina com a orbe flutuante.

### 3.3 Indicador claro de microfone + mudo fácil 🟢 ✅
Sinal sempre visível quando o microfone está ouvindo e um botão grande de silenciar.
- **Por quê:** confiança e privacidade — a pessoa precisa ver quando está sendo ouvida.
- **Base atual:** já há estados visuais; falta um indicador dedicado e persistente de mic.

### 3.4 Backup e restauração em 1 clique 🟢 ✅
Exportar/importar todos os dados (tarefas, agenda, memória) num arquivo; backup automático.
- **Por quê:** o medo de perder dados é real para quem não é técnico.
- **Base atual:** os dados já são arquivos locais simples — falta só o botão de exportar/importar.

---

## Prioridade 4 — Comunicação e proatividade (com confirmação)

### 4.1 Rascunhar mensagens e e‑mails 🔴 ✅
“escreve um e‑mail pro João dizendo que vou me atrasar” → mostra o texto para revisar **antes**
de enviar.
- **Por quê:** economiza tempo; manter a confirmação evita envios indevidos.

### 4.2 “Bom dia” automático (briefing agendado) 🟢 ✅
Briefing falado com clima, agenda e tarefas ao abrir ou em um horário escolhido.
- **Por quê:** transforma o Ares num companheiro proativo logo cedo.
- **Base atual:** o briefing já existe e já é falável; falta o agendamento opcional.

---

## Próxima grande implementação: Ares + Hermes

Objetivo: fazer o Ares "fazer tudo que o Hermes faz" e ligar o **controle de voz do Ares
diretamente ao Hermes, sem perder a qualidade do Hermes**.

### Recomendação: Ares como front-end de voz do Hermes (ponte), não um clone

Ares e Hermes já compartilham o mesmo cérebro (9 Router `cx/gpt-5.5`). Reescrever o Hermes
dentro do Ares duplicaria esforço e arriscaria a qualidade. O caminho de maior valor e menor
risco é tratar o Ares como **cliente de voz/desktop** do Hermes:

- o Ares cuida do que faz bem localmente: voz (STT Groq + TTS Piper), orbe/HUD, atalho
  global, conversa contínua e wake word;
- o Hermes continua dono do que faz bem: WhatsApp (Baileys), Trello, Obsidian e o "office"
  de agentes (pedro/junim/maicom), no mesmo pipeline de hoje;
- quando o pedido é "de Hermes", o Ares **delega** ao Hermes via HTTP e fala a resposta.

Assim a qualidade do Hermes é preservada porque **reusamos o Hermes**, não o imitamos.

### Groundwork já deixado nesta atualização

- Config `integrations.hermes { enabled, baseUrl }` + seção em Configurações.
- Ferramenta de agente `hermes.executar { comando }` (POST para o endpoint do Hermes).
- Função `hermesExecute()` em `src/main/tools.ts` (genérica: envia `{message}`, lê `reply`).

### Próximos passos para fechar a integração

1. **Confirmar o contrato HTTP do Hermes** (rota, formato de request/response, auth). Hoje a
   ponte assume `POST /message {message} -> {reply}`; ajustar ao real do Hermes.
2. **Roteamento de intenção**: o prompt decide quando usar `hermes.executar` (ex.: "manda no
   WhatsApp…", "cria card no Trello…", "salva no Obsidian…") vs. resolver localmente.
3. **Voz ponta a ponta**: streaming da resposta do Hermes na fila de fala por sentença (já
   existe no Ares).
4. **Sessão/contexto compartilhado**: enviar ao Hermes um id de sessão para manter contexto
   do "office".
5. **Segurança/confirmação**: ações externas sensíveis (enviar mensagem) pedem confirmação,
   como já fazemos para rascunhos.
6. **Status do Hermes na tela Sistema**: ping ao endpoint, como já fazemos com o 9 Router.

### Alternativas consideradas

- **Skills compartilhadas** (extrair Trello/WhatsApp para um pacote usado pelos dois): mais
  trabalho, só vale se quiser manter os dois evoluindo em paralelo.
- **Fusão total** (Ares vira o Hermes): não recomendado — alto risco de regressão na
  qualidade do Hermes e perda de foco do Ares.
