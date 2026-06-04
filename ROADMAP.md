# Roadmap — Ares para o dia a dia

Este documento reúne **sugestões de novas funcionalidades** pensadas para deixar o Ares
realmente útil e fácil para **pessoas comuns** (sem conhecimento técnico). Nada aqui está
implementado ainda — é uma lista priorizada de próximos passos, com o motivo de cada item
e uma noção de esforço.

> Onde já existe base no app, indico o módulo entre parênteses para mostrar que é uma
> evolução do que já funciona, não um recomeço.

Legenda de esforço: 🟢 baixo · 🟡 médio · 🔴 alto.

---

## Prioridade 1 — Tirar o atrito de começar a usar

Hoje o app abre direto no painel HUD. Quem não é técnico precisa de ajuda para dar o
primeiro passo. Esta é a área de maior impacto para adoção.

### 1.1 Assistente de primeiros passos (onboarding) 🟡
Na primeira abertura: perguntar o nome, detectar a localização, testar a voz e o microfone
e um mini‑tutorial “fale comigo”.
- **Por quê:** transforma a primeira impressão; sem isso, muita gente desiste na tela inicial.
- **Base atual:** config, localização e teste de voz já existem; falta o passo a passo guiado.

### 1.2 Ajuda “O que você sabe fazer?” 🟢
Um botão (e o comando de voz) que mostra **exemplos clicáveis**: “crie uma tarefa”,
“vai chover hoje?”, “me lembra do remédio às 8h”, “faça meu briefing”.
- **Por quê:** descoberta. As pessoas não sabem o que pedir; exemplos prontos ensinam usando.
- **Base atual:** o agente já entende esses comandos; falta a vitrine de exemplos.

### 1.3 Cérebro sem complicação 🟡
Além do 9 Router local, oferecer um caminho “cole a chave e funciona” (provedor hospedado)
com teste de conexão no onboarding e mensagem clara quando o cérebro está offline.
- **Por quê:** exigir rodar um servidor local é a maior barreira para o público geral.
- **Base atual:** a configuração do endpoint já existe e a tela Sistema já testa o 9 Router.

---

## Prioridade 2 — Valor prático no dia a dia

Funções que as pessoas usam o tempo todo, com o mínimo de fricção.

### 2.1 Listas simples (compras, afazeres) 🟢
Uma lista separada do Kanban: “adiciona leite na lista de compras”, marcar item com um toque.
- **Por quê:** o Kanban é ótimo, mas “técnico” demais para uma lista de mercado.
- **Base atual:** persistência local e ações por voz já existem (reaproveita o padrão de dados).

### 2.2 Lembretes de remédio e rotina por voz 🟡
“me lembra de tomar o remédio todo dia às 8h”, com repetição e som; confirmação de “tomei”.
- **Por quê:** utilidade altíssima, em especial para famílias e pessoas mais velhas.
- **Base atual:** lembretes, recorrência e notificações já existem; falta o atalho “saúde/rotina”.

### 2.3 Timer, cronômetro e despertador por voz 🟢
“põe um timer de 10 minutos”, “me acorda às 6h”, com aviso sonoro.
- **Por quê:** necessidade diária (cozinha, soneca, foco). Simples e muito usado.

### 2.4 Contas rápidas e conversões 🟢
“quanto é 30% de 250?”, conversões de medida e **cotação de moeda**.
- **Por quê:** tira dúvidas do dia sem abrir calculadora ou navegador.
- **Base atual:** seria uma nova ferramenta de consulta no agente (como clima/notícias).

### 2.5 Anotações e diário rápido 🟢
“anota que…”, uma tela de notas rápidas; opção de “diário” por voz no fim do dia.
- **Por quê:** capturar ideias no momento, sem fricção.

---

## Prioridade 3 — Conforto, acessibilidade e confiança

### 3.1 Acessibilidade e “modo simples” 🟡
Tamanho de fonte ajustável, alto contraste e uma visão reduzida (menos HUD, textos maiores).
- **Por quê:** inclui pessoas mais velhas ou com baixa visão e diminui a “intimidação” da
  interface futurista.

### 3.2 Atalho global + ícone na bandeja + iniciar com o sistema 🟡
Chamar o Ares de qualquer lugar com uma tecla; ícone na barra do sistema; abrir junto com o
computador.
- **Por quê:** presença constante e zero fricção para acionar. Combina com a orbe flutuante.

### 3.3 Indicador claro de microfone + mudo fácil 🟢
Sinal sempre visível quando o microfone está ouvindo e um botão grande de silenciar.
- **Por quê:** confiança e privacidade — a pessoa precisa ver quando está sendo ouvida.
- **Base atual:** já há estados visuais; falta um indicador dedicado e persistente de mic.

### 3.4 Backup e restauração em 1 clique 🟢
Exportar/importar todos os dados (tarefas, agenda, memória) num arquivo; backup automático.
- **Por quê:** o medo de perder dados é real para quem não é técnico.
- **Base atual:** os dados já são arquivos locais simples — falta só o botão de exportar/importar.

---

## Prioridade 4 — Comunicação e proatividade (com confirmação)

### 4.1 Rascunhar mensagens e e‑mails 🔴
“escreve um e‑mail pro João dizendo que vou me atrasar” → mostra o texto para revisar **antes**
de enviar.
- **Por quê:** economiza tempo; manter a confirmação evita envios indevidos.

### 4.2 “Bom dia” automático (briefing agendado) 🟢
Briefing falado com clima, agenda e tarefas ao abrir ou em um horário escolhido.
- **Por quê:** transforma o Ares num companheiro proativo logo cedo.
- **Base atual:** o briefing já existe e já é falável; falta o agendamento opcional.

---

## Resumo — as 5 que eu faria primeiro

1. **Onboarding guiado** (1.1) — remove a maior barreira de entrada.
2. **Ajuda com exemplos clicáveis** (1.2) — as pessoas passam a saber o que pedir.
3. **Lembretes de remédio/rotina + listas simples** (2.2 e 2.1) — valor prático imediato.
4. **Timer/despertador por voz** (2.3) — uso diário, baixo esforço.
5. **Backup em 1 clique + indicador de microfone** (3.4 e 3.3) — confiança para usar sem medo.

> Estas são sugestões. Diga quais você quer e eu implemento na ordem que preferir,
> sempre mantendo `tsc`, `build` e `dev` verdes e tudo local, sem login.
